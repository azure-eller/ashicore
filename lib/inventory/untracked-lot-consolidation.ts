import { and, eq, isNull, sql } from "drizzle-orm";
import { inventoryLotBalances, itemFamilies, items, lots } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import {
  appendPositiveStockToExistingLotInTx,
  decrementExistingLotStockInTx,
  getOrCreateInternalUntrackedLotInTx,
} from "@/lib/inventory/kernel/operations/stock-core";
import { lockItemsInTx } from "@/lib/inventory/kernel/locking";

export type UntrackedLotConsolidationResult = {
  itemId: string;
  canonicalLotId: string;
  movedLotCount: number;
};

export async function consolidateUntrackedItemLotsInTx(
  tx: Tx,
  params: {
    organizationId: string;
    locationId: string;
    itemId: string;
    actorUserId?: string | null;
    occurredAt?: Date | null;
  }
): Promise<UntrackedLotConsolidationResult> {
  await lockItemsInTx(tx, [params.itemId]);

  const canonical = await getOrCreateInternalUntrackedLotInTx(tx, {
    organizationId: params.organizationId,
    itemId: params.itemId,
    occurredAt: params.occurredAt,
  });

  const oldBalances = await tx
    .select({
      lotId: inventoryLotBalances.lotId,
      quantity: inventoryLotBalances.quantity,
      unitCost: inventoryLotBalances.unitCost,
    })
    .from(inventoryLotBalances)
    .innerJoin(lots, eq(lots.id, inventoryLotBalances.lotId))
    .where(
      and(
        eq(inventoryLotBalances.organizationId, params.organizationId),
        eq(inventoryLotBalances.locationId, params.locationId),
        eq(inventoryLotBalances.itemId, params.itemId),
        eq(inventoryLotBalances.disposition, "available"),
        sql`${inventoryLotBalances.quantity} <> 0`,
        sql`${inventoryLotBalances.lotId} <> ${canonical.id}`
      )
    )
    .orderBy(inventoryLotBalances.receivedAt, inventoryLotBalances.lotId)
    .for("update");

  let movedLotCount = 0;
  for (const balance of oldBalances) {
    const quantity = Number(balance.quantity);
    if (quantity < 0) {
      throw new Error(
        "Lot tracking cannot be turned off while negative tracked lot stock exists."
      );
    }
    if (quantity === 0) continue;

    await decrementExistingLotStockInTx(tx, {
      organizationId: params.organizationId,
      locationId: params.locationId,
      itemId: params.itemId,
      lotId: balance.lotId,
      quantity,
      unitCost: balance.unitCost,
      eventType: "manual_adjustment_decrease",
      eventSubtype: "lot_tracking_consolidation",
      referenceType: "item",
      referenceId: params.itemId,
      actorUserId: params.actorUserId ?? null,
      occurredAt: params.occurredAt ?? undefined,
      metadata: { internalUntrackedLotConsolidation: true },
    });
    await appendPositiveStockToExistingLotInTx(tx, {
      organizationId: params.organizationId,
      locationId: params.locationId,
      itemId: params.itemId,
      lotId: canonical.id,
      quantity,
      unitCost: balance.unitCost ?? "0",
      eventType: "manual_adjustment_increase",
      eventSubtype: "lot_tracking_consolidation",
      referenceType: "item",
      referenceId: params.itemId,
      actorUserId: params.actorUserId ?? null,
      occurredAt: params.occurredAt ?? undefined,
      metadata: { internalUntrackedLotConsolidation: true },
    });
    movedLotCount += 1;
  }

  return {
    itemId: params.itemId,
    canonicalLotId: canonical.id,
    movedLotCount,
  };
}

export async function consolidateUntrackedFamilyLotsInTx(
  tx: Tx,
  params: {
    organizationId: string;
    locationId: string;
    familyId: string;
    actorUserId?: string | null;
    occurredAt?: Date | null;
  }
) {
  const variantRows = await tx
    .select({ id: items.id })
    .from(items)
    .innerJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
    .where(
      and(
        eq(itemFamilies.id, params.familyId),
        eq(items.organizationId, params.organizationId),
        isNull(items.deletedAt)
      )
    );

  const results: UntrackedLotConsolidationResult[] = [];
  for (const row of variantRows) {
    results.push(
      await consolidateUntrackedItemLotsInTx(tx, {
        organizationId: params.organizationId,
        locationId: params.locationId,
        itemId: row.id,
        actorUserId: params.actorUserId ?? null,
        occurredAt: params.occurredAt,
      })
    );
  }

  return results;
}
