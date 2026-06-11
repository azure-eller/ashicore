import "server-only";
import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import {
  inventoryEvents,
  inventoryLocations,
  inventoryLotBalances,
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

async function assertCodeAvailableInTx(tx: Tx, orgId: string, code: string, excludeId?: string) {
  const conflict = await tx.query.inventoryLocations.findFirst({
    where: and(
      eq(inventoryLocations.organizationId, orgId),
      eq(inventoryLocations.code, code),
      isNull(inventoryLocations.deletedAt),
      excludeId ? ne(inventoryLocations.id, excludeId) : undefined
    ),
  });
  if (conflict) {
    throw new InventoryError("A location with this code already exists.", 409);
  }
}

export async function getInventoryLocations(): Promise<LocationRow[]> {
  return withAuthedOrgContext(async (tx, orgId) => {
    await getDefaultInventoryLocationInTx(tx, orgId);
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
      await tx
        .update(inventoryLocations)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(
            eq(inventoryLocations.organizationId, orgId),
            eq(inventoryLocations.isDefault, true),
            isNull(inventoryLocations.deletedAt)
          )
        );
    }

    const [row] = await tx
      .update(inventoryLocations)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.code !== undefined ? { code: data.code } : {}),
        ...(data.isDefault ? { isDefault: true } : {}),
        updatedAt: new Date(),
      })
      .where(eq(inventoryLocations.id, locationId))
      .returning(locationColumns);
    return row;
  });
}

export async function deleteInventoryLocation(locationId: string): Promise<boolean> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const existing = await getActiveLocationInTx(tx, orgId, locationId);
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
