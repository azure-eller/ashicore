import "server-only";
import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import {
  inventoryDemandSummary,
  inventoryEvents,
  inventoryExpectedSummary,
  inventoryItemBalances,
  inventoryLocations,
  inventoryLotBalances,
  stocktakes,
} from "@/lib/db/schema";
import { assertFeatureAccessInTx } from "@/lib/billing/entitlements";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { getDefaultInventoryLocationInTx } from "@/lib/inventory/kernel/locations";
import type { Tx } from "@/lib/db/with-org-context";
import type { InsertLocation, UpdateLocation } from "@/lib/schemas/locations";
import { InventoryError } from "./errors";

export type LocationRow = {
  id: string;
  name: string;
  code: string;
  isDefault: boolean;
  hasActivity: boolean;
};

const locationColumns = {
  id: inventoryLocations.id,
  name: inventoryLocations.name,
  code: inventoryLocations.code,
  isDefault: inventoryLocations.isDefault,
};

const hasActivityExpr = sql<boolean>`exists (
  select 1
  from ${inventoryLotBalances}
  where ${inventoryLotBalances.locationId} = ${inventoryLocations.id}
    and ${inventoryLotBalances.quantity} <> 0
) or exists (
  select 1
  from ${inventoryEvents}
  where ${inventoryEvents.locationId} = ${inventoryLocations.id}
)`;

async function getActiveLocationInTx(tx: Tx, orgId: string, locationId: string) {
  return tx.query.inventoryLocations.findFirst({
    where: and(
      eq(inventoryLocations.id, locationId),
      eq(inventoryLocations.organizationId, orgId),
      isNull(inventoryLocations.deletedAt)
    ),
  });
}

async function getLocationRowInTx(
  tx: Tx,
  orgId: string,
  locationId: string
): Promise<LocationRow | null> {
  const [row] = await tx
    .select({ ...locationColumns, hasActivity: hasActivityExpr.as("hasActivity") })
    .from(inventoryLocations)
    .where(
      and(
        eq(inventoryLocations.id, locationId),
        eq(inventoryLocations.organizationId, orgId),
        isNull(inventoryLocations.deletedAt)
      )
    );

  return row ?? null;
}

async function assertCodeAvailableInTx(tx: Tx, orgId: string, code: string, excludeId?: string) {
  const conflict = await tx.query.inventoryLocations.findFirst({
    where: and(
      eq(inventoryLocations.organizationId, orgId),
      sql`lower(${inventoryLocations.code}) = ${code.toLowerCase()}`,
      isNull(inventoryLocations.deletedAt),
      excludeId ? ne(inventoryLocations.id, excludeId) : undefined
    ),
  });
  if (conflict) {
    throw new InventoryError("A location with this code already exists.", 409);
  }
}

async function assertDefaultSwapSafeInTx(
  tx: Tx,
  orgId: string,
  currentDefaultLocationId: string
) {
  const [draftStocktake] = await tx
    .select({ id: stocktakes.id })
    .from(stocktakes)
    .where(
      and(
        eq(stocktakes.organizationId, orgId),
        eq(stocktakes.status, "draft")
      )
    )
    .limit(1);
  if (draftStocktake) {
    throw new InventoryError(
      "Complete or cancel draft stocktakes before changing the default location.",
      409
    );
  }

  const [openBalanceState] = await tx
    .select({ itemId: inventoryItemBalances.itemId })
    .from(inventoryItemBalances)
    .where(
      and(
        eq(inventoryItemBalances.organizationId, orgId),
        eq(inventoryItemBalances.locationId, currentDefaultLocationId),
        sql`(${inventoryItemBalances.onHandQty} <> 0 OR ${inventoryItemBalances.demandQty} <> 0 OR ${inventoryItemBalances.expectedQty} <> 0)`
      )
    )
    .limit(1);
  if (openBalanceState) {
    throw new InventoryError(
      "Move or close stock, demand, and expected supply before changing the default location.",
      409
    );
  }

  const [openDemand] = await tx
    .select({ referenceId: inventoryDemandSummary.referenceId })
    .from(inventoryDemandSummary)
    .where(
      and(
        eq(inventoryDemandSummary.organizationId, orgId),
        eq(inventoryDemandSummary.locationId, currentDefaultLocationId),
        sql`${inventoryDemandSummary.quantity} <> 0`
      )
    )
    .limit(1);
  if (openDemand) {
    throw new InventoryError(
      "Close or fulfill open demand before changing the default location.",
      409
    );
  }

  const [openExpectedSupply] = await tx
    .select({ referenceId: inventoryExpectedSummary.referenceId })
    .from(inventoryExpectedSummary)
    .where(
      and(
        eq(inventoryExpectedSummary.organizationId, orgId),
        eq(inventoryExpectedSummary.locationId, currentDefaultLocationId),
        sql`${inventoryExpectedSummary.quantity} <> 0`
      )
    )
    .limit(1);
  if (openExpectedSupply) {
    throw new InventoryError(
      "Close or receive expected supply before changing the default location.",
      409
    );
  }
}

export async function getInventoryLocations(): Promise<LocationRow[]> {
  return withAuthedOrgContext(async (tx, orgId) => {
    return tx
      .select({ ...locationColumns, hasActivity: hasActivityExpr.as("hasActivity") })
      .from(inventoryLocations)
      .where(
        and(
          eq(inventoryLocations.organizationId, orgId),
          isNull(inventoryLocations.deletedAt)
        )
      )
      .orderBy(desc(inventoryLocations.isDefault), asc(inventoryLocations.name));
  });
}

export async function createInventoryLocation(data: InsertLocation) {
  return withAuthedOrgContext(async (tx, orgId) => {
    // The auto-created default location is free; every location created
    // through this path is an additional one, which is the gated action.
    await getDefaultInventoryLocationInTx(tx, orgId);
    await assertFeatureAccessInTx(tx, orgId, "multi_location", {
      route: "/api/locations",
    });
    await assertCodeAvailableInTx(tx, orgId, data.code);

    const [row] = await tx
      .insert(inventoryLocations)
      .values({ ...data, organizationId: orgId, isDefault: false })
      .returning(locationColumns);
    return { ...row, hasActivity: false };
  });
}

export async function updateInventoryLocation(locationId: string, data: UpdateLocation) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const existing = await getActiveLocationInTx(tx, orgId, locationId);
    if (!existing) {
      throw new InventoryError("Location not found.", 404);
    }
    if (data.isDefault === false && existing.isDefault) {
      throw new InventoryError(
        "Make another location the default instead of unsetting this one.",
        409
      );
    }
    if (data.code && data.code !== existing.code) {
      await assertCodeAvailableInTx(tx, orgId, data.code, locationId);
    }
    if (data.isDefault && !existing.isDefault) {
      // Lock the current default row first: serializes concurrent swaps and
      // pins the row the safety checks run against.
      const [currentDefault] = await tx
        .select({ id: inventoryLocations.id })
        .from(inventoryLocations)
        .where(
          and(
            eq(inventoryLocations.organizationId, orgId),
            eq(inventoryLocations.isDefault, true),
            isNull(inventoryLocations.deletedAt)
          )
        )
        .for("update");
      if (currentDefault) {
        await assertDefaultSwapSafeInTx(tx, orgId, currentDefault.id);
        await tx
          .update(inventoryLocations)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(eq(inventoryLocations.id, currentDefault.id));
      }
    }

    const [row] = await tx
      .update(inventoryLocations)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.code !== undefined ? { code: data.code } : {}),
        ...(data.isDefault ? { isDefault: true } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(inventoryLocations.id, locationId),
          eq(inventoryLocations.organizationId, orgId),
          isNull(inventoryLocations.deletedAt)
        )
      )
      .returning(locationColumns);
    if (!row) {
      throw new InventoryError("Location not found.", 404);
    }

    const updated = await getLocationRowInTx(tx, orgId, row.id);
    if (!updated) {
      throw new InventoryError("Location not found.", 404);
    }
    return updated;
  });
}

export async function deleteInventoryLocation(locationId: string): Promise<boolean> {
  return withAuthedOrgContext(async (tx, orgId) => {
    // FOR UPDATE pairs with the FOR SHARE taken by transfer location
    // resolution: an in-flight transfer blocks the delete until it commits,
    // so stock cannot land in a location deleted under it.
    const [existing] = await tx
      .select({ id: inventoryLocations.id, isDefault: inventoryLocations.isDefault })
      .from(inventoryLocations)
      .where(
        and(
          eq(inventoryLocations.id, locationId),
          eq(inventoryLocations.organizationId, orgId),
          isNull(inventoryLocations.deletedAt)
        )
      )
      .for("update");
    if (!existing) {
      return false;
    }
    if (existing.isDefault) {
      throw new InventoryError("The default location cannot be deleted.", 409);
    }

    const [activity] = await tx
      .select({ hasActivity: hasActivityExpr.as("hasActivity") })
      .from(inventoryLocations)
      .where(eq(inventoryLocations.id, locationId));
    if (activity?.hasActivity) {
      throw new InventoryError(
        "This location has inventory activity and cannot be deleted.",
        409
      );
    }

    await tx
      .update(inventoryLocations)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(inventoryLocations.id, locationId));
    return true;
  });
}
