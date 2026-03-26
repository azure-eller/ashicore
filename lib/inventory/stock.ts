import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { items, lots, stockMovements } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";

export const STOCK_MOVEMENT_TYPES = [
  "manual_adjustment",
  "manufacturing_consumed",
  "manufacturing_produced",
  "purchase_received",
] as const;

export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];
export type StockReferenceType = "manufacturing_order" | "purchase_order" | null;

export type FifoAllocation = {
  lotId: string;
  lotNumber: string;
  quantity: number;
  costPerUnit: number | null;
};

function getStableItemIds(itemIds: string[]) {
  return [...new Set(itemIds)].sort();
}

export class InsufficientStockError extends Error {
  itemId: string;
  available: number;
  requested: number;

  constructor(params: { itemId: string; available: number; requested: number }) {
    super(
      `Insufficient stock. Available: ${params.available}, requested: ${params.requested}`
    );
    this.name = "InsufficientStockError";
    this.itemId = params.itemId;
    this.available = params.available;
    this.requested = params.requested;
  }
}

export async function lockItemsInTx(tx: Tx, itemIds: string[]) {
  const stableItemIds = getStableItemIds(itemIds);

  if (stableItemIds.length === 0) {
    return;
  }

  await tx
    .select({ id: items.id })
    .from(items)
    .where(inArray(items.id, stableItemIds))
    .orderBy(asc(items.id))
    .for("update");
}

async function getLockedPositiveLotsInTx(tx: Tx, itemId: string) {
  return tx
    .select({
      id: lots.id,
      lotNumber: lots.lotNumber,
      quantity: lots.quantity,
      costPerUnit: lots.costPerUnit,
    })
    .from(lots)
    .where(and(eq(lots.itemId, itemId), sql`${lots.quantity} > 0`))
    .orderBy(asc(lots.receivedAt), asc(lots.id))
    .for("update");
}


export async function generateLotNumber(tx: Tx): Promise<string> {
  const result = await tx.execute(
    sql`SELECT nextval('inventory.lot_number_seq') AS val`
  );
  const val = Number((result.rows[0] as { val: string }).val);
  return `LOT-${String(val).padStart(6, "0")}`;
}

export async function getCurrentStockInTx(tx: Tx, itemId: string): Promise<number> {
  const [row] = await tx
    .select({ total: sql<string>`COALESCE(SUM(${lots.quantity}), 0)` })
    .from(lots)
    .where(eq(lots.itemId, itemId));

  return parseFloat(row?.total ?? "0");
}

export async function createStockMovementInTx(
  tx: Tx,
  params: {
    orgId: string;
    itemId: string;
    lotId: string | null;
    quantity: number;
    userId: string;
    movementType?: StockMovementType;
    referenceType?: StockReferenceType;
    referenceId?: string | null;
  }
) {
  await tx.insert(stockMovements).values({
    organizationId: params.orgId,
    itemId: params.itemId,
    lotId: params.lotId,
    quantity: params.quantity.toString(),
    movementType: params.movementType ?? "manual_adjustment",
    referenceType: params.referenceType ?? null,
    referenceId: params.referenceId ?? null,
    createdBy: params.userId,
  });
}

export async function createPositiveLotAndMovementInTx(
  tx: Tx,
  params: {
    orgId: string;
    itemId: string;
    quantity: number;
    userId: string;
    costPerUnit?: string | null;
    movementType?: StockMovementType;
    referenceType?: StockReferenceType;
    referenceId?: string | null;
  }
): Promise<{ lotId: string; lotNumber: string }> {
  await lockItemsInTx(tx, [params.itemId]);

  const lotNumber = await generateLotNumber(tx);
  const [newLot] = await tx
    .insert(lots)
    .values({
      organizationId: params.orgId,
      itemId: params.itemId,
      lotNumber,
      quantity: params.quantity.toString(),
      costPerUnit: params.costPerUnit ?? null,
    })
    .returning({ id: lots.id });

  await createStockMovementInTx(tx, {
    orgId: params.orgId,
    itemId: params.itemId,
    lotId: newLot.id,
    quantity: params.quantity,
    userId: params.userId,
    movementType: params.movementType,
    referenceType: params.referenceType,
    referenceId: params.referenceId,
  });

  return { lotId: newLot.id, lotNumber };
}

export async function fifoConsumeStockInTx(
  tx: Tx,
  itemId: string,
  amount: number
): Promise<FifoAllocation[]> {
  await lockItemsInTx(tx, [itemId]);

  const availableLots = await getLockedPositiveLotsInTx(tx, itemId);

  const totalAvailable = availableLots.reduce(
    (sum, lot) => sum + parseFloat(lot.quantity),
    0
  );

  if (totalAvailable < amount) {
    throw new InsufficientStockError({
      itemId,
      available: totalAvailable,
      requested: amount,
    });
  }

  let remaining = amount;
  const allocations: FifoAllocation[] = [];

  for (const lot of availableLots) {
    if (remaining <= 0) break;

    const lotQty = parseFloat(lot.quantity);
    const deduct = Math.min(lotQty, remaining);

    const [updatedLot] = await tx
      .update(lots)
      .set({
        quantity: sql`${lots.quantity} - ${deduct}`,
        updatedAt: new Date(),
      })
      .where(and(eq(lots.id, lot.id), sql`${lots.quantity} >= ${deduct}`))
      .returning({ id: lots.id });

    if (!updatedLot) {
      throw new InsufficientStockError({
        itemId,
        available: totalAvailable,
        requested: amount,
      });
    }

    allocations.push({
      lotId: lot.id,
      lotNumber: lot.lotNumber,
      quantity: deduct,
      costPerUnit: lot.costPerUnit != null ? parseFloat(lot.costPerUnit) : null,
    });
    remaining -= deduct;
  }

  return allocations;
}

export async function applyStockDeltaInTx(
  tx: Tx,
  params: {
    orgId: string;
    userId: string;
    itemId: string;
    delta: number;
    costPerUnit?: string | null;
    movementType?: StockMovementType;
    referenceType?: StockReferenceType;
    referenceId?: string | null;
  }
): Promise<{
  createdLot?: { lotId: string; lotNumber: string };
  allocations?: FifoAllocation[];
}> {
  if (params.delta > 0) {
    const createdLot = await createPositiveLotAndMovementInTx(tx, {
      orgId: params.orgId,
      itemId: params.itemId,
      quantity: params.delta,
      userId: params.userId,
      costPerUnit: params.costPerUnit,
      movementType: params.movementType,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
    });
    return { createdLot };
  }

  if (params.delta < 0) {
    const allocations = await fifoConsumeStockInTx(
      tx,
      params.itemId,
      Math.abs(params.delta)
    );

    for (const allocation of allocations) {
      await createStockMovementInTx(tx, {
        orgId: params.orgId,
        itemId: params.itemId,
        lotId: allocation.lotId,
        quantity: -allocation.quantity,
        userId: params.userId,
        movementType: params.movementType,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
      });
    }

    return { allocations };
  }

  return {};
}
