import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  inventoryItemBalances,
  inventoryLocations,
  inventoryTransferLines,
  inventoryTransfers,
  items,
} from "@/lib/db/schema";
import { assertFeatureAccessInTx } from "@/lib/billing/entitlements";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { trimScale } from "@/lib/db/numeric";
import {
  beginInventoryOperationInTx,
  finishInventoryOperationInTx,
  transferStockInTx,
} from "@/lib/inventory/kernel/operations";
import type { ItemLocationBalance } from "@/lib/inventory/types";
import type { CreateTransfer } from "@/lib/schemas/transfers";
import type { Tx } from "@/lib/db/with-org-context";
import { InventoryError } from "./errors";

export type CreateTransferResult = {
  id: string;
};

async function assertActiveLocationsInTx(
  tx: Tx,
  orgId: string,
  locationIds: string[]
) {
  const uniqueLocationIds = [...new Set(locationIds)];
  const rows = await tx
    .select({ id: inventoryLocations.id })
    .from(inventoryLocations)
    .where(
      and(
        eq(inventoryLocations.organizationId, orgId),
        inArray(inventoryLocations.id, uniqueLocationIds),
        isNull(inventoryLocations.deletedAt)
      )
    );

  if (rows.length !== uniqueLocationIds.length) {
    throw new InventoryError("Inventory location not found.", 404);
  }
}

async function assertActiveTransferItemsInTx(
  tx: Tx,
  orgId: string,
  itemIds: string[]
) {
  const uniqueItemIds = [...new Set(itemIds)];
  const rows = await tx
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        eq(items.organizationId, orgId),
        inArray(items.id, uniqueItemIds),
        isNull(items.deletedAt)
      )
    );

  if (rows.length !== uniqueItemIds.length) {
    throw new InventoryError("Item not found.", 404);
  }
}

export async function createInventoryTransfer(
  data: CreateTransfer,
  options: { idempotencyKey: string }
): Promise<CreateTransferResult> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    // The DAL owns the idempotency claim so a replay cannot re-insert the
    // transfer document; the kernel op runs key-less inside the same claim.
    const replay = await beginInventoryOperationInTx<CreateTransferResult>(tx, {
      organizationId: orgId,
      operationName: "transferStock",
      idempotencyKey: options.idempotencyKey,
      payload: {
        fromLocationId: data.fromLocationId,
        toLocationId: data.toLocationId,
        note: data.note ?? null,
        lines: data.lines,
      },
    });
    if (replay.replayed) {
      return replay.result;
    }

    await assertFeatureAccessInTx(tx, orgId, "multi_location", {
      route: "/api/inventory/transfers",
    });
    await assertActiveLocationsInTx(tx, orgId, [
      data.fromLocationId,
      data.toLocationId,
    ]);
    await assertActiveTransferItemsInTx(
      tx,
      orgId,
      data.lines.map((line) => line.itemId)
    );

    const [header] = await tx
      .insert(inventoryTransfers)
      .values({
        organizationId: orgId,
        fromLocationId: data.fromLocationId,
        toLocationId: data.toLocationId,
        note: data.note ?? null,
        createdByUserId: userId,
      })
      .returning({ id: inventoryTransfers.id });

    await tx.insert(inventoryTransferLines).values(
      data.lines.map((line, index) => ({
        transferId: header.id,
        itemId: line.itemId,
        quantity: line.quantity,
        sortOrder: index,
      }))
    );

    const transferred = await transferStockInTx(tx, {
      organizationId: orgId,
      transferId: header.id,
      fromLocationId: data.fromLocationId,
      toLocationId: data.toLocationId,
      lines: data.lines.map((line) => ({
        itemId: line.itemId,
        quantity: Number(line.quantity),
      })),
      actorUserId: userId,
    });

    const result: CreateTransferResult = { id: header.id };

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options.idempotencyKey,
      firstEventId: transferred.eventIds[0] ?? null,
      result,
    });

    return result;
  });
}

export async function getItemLocationBalances(
  itemId: string
): Promise<ItemLocationBalance[]> {
  return withAuthedOrgContext(async (tx, orgId) => {
    await assertActiveTransferItemsInTx(tx, orgId, [itemId]);

    return tx
      .select({
        locationId: inventoryLocations.id,
        locationName: inventoryLocations.name,
        isDefault: inventoryLocations.isDefault,
        onHandQty: trimScale(
          sql`COALESCE(${inventoryItemBalances.onHandQty}, 0)`
        ).as("onHandQty"),
      })
      .from(inventoryLocations)
      .leftJoin(
        inventoryItemBalances,
        and(
          eq(inventoryItemBalances.locationId, inventoryLocations.id),
          eq(inventoryItemBalances.itemId, itemId),
          eq(inventoryItemBalances.organizationId, orgId)
        )
      )
      .where(
        and(
          eq(inventoryLocations.organizationId, orgId),
          isNull(inventoryLocations.deletedAt)
        )
      )
      .orderBy(
        sql`${inventoryLocations.isDefault} DESC`,
        inventoryLocations.name
      );
  });
}

export async function getActiveLocationCount(): Promise<number> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [row] = await tx
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(inventoryLocations)
      .where(
        and(
          eq(inventoryLocations.organizationId, orgId),
          isNull(inventoryLocations.deletedAt)
        )
      );
    return row?.count ?? 0;
  });
}
