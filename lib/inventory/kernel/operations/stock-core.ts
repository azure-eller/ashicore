import { and, asc, eq, sql } from "drizzle-orm";
import {
  normalizeNumeric,
  normalizeNumericScale,
  roundQuantity,
} from "@/lib/format";
import {
  type InventoryDisposition,
  inventoryItemBalances,
  inventoryLotBalances,
  items,
  lots,
} from "@/lib/db/schema";
import { getCurrentActiveBomIngredientsInTx } from "@/lib/bom/active-ingredients";
import type { Tx } from "@/lib/db/with-org-context";
import {
  applyItemBalanceDeltasInTx,
  applyLotBalanceDeltasInTx,
} from "@/lib/inventory/kernel/projections";
import { insertInventoryEventsInTx } from "@/lib/inventory/kernel/events";
import { lockItemsInTx } from "@/lib/inventory/kernel/locking";
import {
  InsufficientStockError,
  MissingCostBasisError,
} from "@/lib/inventory/kernel/errors";
import {
  normalizeStockUnitCost,
  resolveStockUnitCostFromDefaultPurchasePrice,
} from "@/lib/inventory/cost";

type PositiveStockEventType =
  | "opening_balance"
  | "purchase_receipt"
  | "manufacturing_output"
  | "manual_adjustment_increase"
  | "stocktake_gain"
  | "manufacturing_variance_gain";

type NegativeStockEventType =
  | "manual_adjustment_decrease"
  | "stocktake_loss"
  | "sales_consumption"
  | "manufacturing_ingredient_consumption"
  | "manufacturing_variance_loss";

type RestockEventType = "unpick_restock" | "manufacturing_variance_gain";

const DEFAULT_DISPOSITION: InventoryDisposition = "available";

export type FifoAllocation = {
  lotId: string;
  lotNumber: string;
  quantity: number;
  unitCost: number;
  receivedAt: Date;
};

export async function generateLotNumberInTx(tx: Tx) {
  const result = await tx.execute(
    sql`SELECT nextval('inventory.lot_number_seq') AS val`
  );
  const raw = (result.rows[0] as { val: string | number }).val;
  return `LOT-${String(Number(raw)).padStart(6, "0")}`;
}

export async function getCurrentOnHandQtyInTx(tx: Tx, itemId: string) {
  const [row] = await tx
    .select({
      quantity: sql<string>`COALESCE(SUM(${inventoryItemBalances.onHandQty}), 0)`,
    })
    .from(inventoryItemBalances)
    .where(eq(inventoryItemBalances.itemId, itemId));

  return parseFloat(row?.quantity ?? "0");
}

export async function getCurrentAvailableOnHandQtyInTx(tx: Tx, itemId: string) {
  const [row] = await tx
    .select({
      quantity: sql<string>`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`,
    })
    .from(inventoryLotBalances)
    .where(
      and(
        eq(inventoryLotBalances.itemId, itemId),
        eq(inventoryLotBalances.disposition, DEFAULT_DISPOSITION),
        sql`${inventoryLotBalances.quantity} > 0`
      )
    );

  return parseFloat(row?.quantity ?? "0");
}

export async function getCurrentAvailableQtyInTx(tx: Tx, itemId: string) {
  const [reservable] = await tx
    .select({
      quantity: sql<string>`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`,
    })
    .from(inventoryLotBalances)
    .where(
      and(
        eq(inventoryLotBalances.itemId, itemId),
        eq(inventoryLotBalances.disposition, DEFAULT_DISPOSITION),
        sql`${inventoryLotBalances.quantity} > 0`
      )
    );
  const [reserved] = await tx
    .select({
      quantity: sql<string>`COALESCE(SUM(${inventoryItemBalances.committedQty}), 0)`,
    })
    .from(inventoryItemBalances)
    .where(eq(inventoryItemBalances.itemId, itemId));

  return Math.max(
    0,
    roundQuantity(
      parseFloat(reservable?.quantity ?? "0") - parseFloat(reserved?.quantity ?? "0")
    )
  );
}

export async function getCurrentAvailableQtyAtLocationInTx(
  tx: Tx,
  params: {
    organizationId: string;
    locationId: string;
    itemId: string;
  }
) {
  const [reservable] = await tx
    .select({
      quantity: sql<string>`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`,
    })
    .from(inventoryLotBalances)
    .where(
      and(
        eq(inventoryLotBalances.organizationId, params.organizationId),
        eq(inventoryLotBalances.locationId, params.locationId),
        eq(inventoryLotBalances.itemId, params.itemId),
        eq(inventoryLotBalances.disposition, DEFAULT_DISPOSITION),
        sql`${inventoryLotBalances.quantity} > 0`
      )
    );
  const [reserved] = await tx
    .select({
      quantity: sql<string>`COALESCE(SUM(${inventoryItemBalances.committedQty}), 0)`,
    })
    .from(inventoryItemBalances)
    .where(
      and(
        eq(inventoryItemBalances.organizationId, params.organizationId),
        eq(inventoryItemBalances.locationId, params.locationId),
        eq(inventoryItemBalances.itemId, params.itemId)
      )
    );

  return Math.max(
    0,
    roundQuantity(
      parseFloat(reservable?.quantity ?? "0") - parseFloat(reserved?.quantity ?? "0")
    )
  );
}

export async function resolvePositiveStockUnitCostInTx(
  tx: Tx,
  params: {
    itemId: string;
    explicitUnitCost?: string | null;
    reason:
      | "opening_cost_required"
      | "material_default_price"
      | "product_bom_cost"
      | "stocktake_cost_policy";
  }
): Promise<string> {
  async function deriveCost(currentItemId: string, visited = new Set<string>()): Promise<string> {
    if (visited.has(currentItemId)) {
      throw new MissingCostBasisError(
        currentItemId,
        "product_bom_cost",
        "Cannot resolve cost because the BOM contains a cycle."
      );
    }

    const [item] = await tx
      .select({
        id: items.id,
        name: items.name,
        itemType: items.itemType,
        currentStockUnitCost: items.currentStockUnitCost,
        defaultPurchasePrice: items.defaultPurchasePrice,
        purchaseToStockFactor: items.purchaseToStockFactor,
        manufacturingMode: items.manufacturingMode,
        expectedBatchYield: items.expectedBatchYield,
      })
      .from(items)
      .where(eq(items.id, currentItemId));

    if (!item) {
      throw new MissingCostBasisError(
        currentItemId,
        params.reason,
        "Cannot resolve cost because the item no longer exists."
      );
    }

    if (item.itemType === "material") {
      const currentStockUnitCost =
        item.currentStockUnitCost != null
          ? Number.parseFloat(item.currentStockUnitCost)
          : Number.NaN;

      if (Number.isFinite(currentStockUnitCost)) {
        return normalizeStockUnitCost(currentStockUnitCost);
      }

      const stockUnitCost = resolveStockUnitCostFromDefaultPurchasePrice({
        defaultPurchasePrice: item.defaultPurchasePrice,
        purchaseToStockFactor: item.purchaseToStockFactor,
      });

      if (stockUnitCost != null) {
        return stockUnitCost;
      }

      if (item.defaultPurchasePrice != null) {
        throw new MissingCostBasisError(
          currentItemId,
          "material_default_price",
          `Cannot resolve cost for ${item.name} because its current stock unit cost is blank and its purchase conversion is invalid.`
        );
      }

      throw new MissingCostBasisError(
        currentItemId,
        "material_default_price",
        `Cannot resolve cost for ${item.name} without a current stock unit cost or default purchase price.`
      );
    }

    const bomRows = await getCurrentActiveBomIngredientsInTx(tx, currentItemId);
    if (bomRows.length === 0) {
      throw new MissingCostBasisError(
        currentItemId,
        "product_bom_cost",
        `Cannot resolve cost for ${item.name} without an active BOM.`
      );
    }

    const nextVisited = new Set(visited);
    nextVisited.add(currentItemId);

    let total = 0;
    for (const component of bomRows) {
      const componentUnitCost = parseFloat(
        await deriveCost(component.itemId, nextVisited)
      );
      total += parseFloat(component.quantityPerUnit ?? "0") * componentUnitCost;
    }

    if (item.manufacturingMode === "batch" && item.expectedBatchYield != null) {
      const expectedBatchYield = parseFloat(item.expectedBatchYield);
      if (Number.isFinite(expectedBatchYield) && expectedBatchYield > 0) {
        return normalizeNumericScale(total / expectedBatchYield, 6);
      }
    }

    return normalizeNumericScale(total, 6);
  }

  if (params.explicitUnitCost != null) {
    return normalizeNumericScale(parseFloat(params.explicitUnitCost), 6);
  }

  if (params.reason === "opening_cost_required") {
    throw new MissingCostBasisError(
      params.itemId,
      "opening_cost_required",
      "Opening stock requires an explicit unit cost."
    );
  }

  return deriveCost(params.itemId);
}

export async function updateMaterialCurrentStockUnitCostInTx(
  tx: Tx,
  params: {
    itemId: string;
    currentStockUnitCost: string | null;
  }
) {
  const normalizedCurrentStockUnitCost =
    params.currentStockUnitCost == null
      ? null
      : normalizeStockUnitCost(Number.parseFloat(params.currentStockUnitCost));

  const [item] = await tx
    .update(items)
    .set({
      currentStockUnitCost: normalizedCurrentStockUnitCost,
      updatedAt: new Date(),
    })
    .where(and(eq(items.id, params.itemId), eq(items.itemType, "material")))
    .returning({
      id: items.id,
      itemType: items.itemType,
      currentStockUnitCost: items.currentStockUnitCost,
    });

  if (!item || item.itemType !== "material") {
    return null;
  }

  return item.currentStockUnitCost;
}

export async function createPositiveStockEventInTx(
  tx: Tx,
  params: {
    organizationId: string;
    locationId: string;
    itemId: string;
    quantity: number;
    unitCost: string;
    eventType: PositiveStockEventType;
    eventSubtype?: string | null;
    referenceType?: string | null;
    referenceId?: string | null;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    lotNumber?: string | null;
    occurredAt?: Date;
    receivedAt?: Date;
    metadata?: Record<string, unknown> | null;
    disposition?: InventoryDisposition;
  }
) {
  await lockItemsInTx(tx, [params.itemId]);

  const quantity = normalizeNumeric(params.quantity);
  const unitCost = normalizeNumericScale(parseFloat(params.unitCost), 6);
  const extendedCost = normalizeNumericScale(
    parseFloat(quantity) * parseFloat(unitCost),
    6
  );
  const disposition = params.disposition ?? DEFAULT_DISPOSITION;
  const lotNumber = params.lotNumber?.trim() || (await generateLotNumberInTx(tx));
  const receivedAt = params.receivedAt ?? params.occurredAt ?? new Date();

  const [lot] = await tx
    .insert(lots)
    .values({
      organizationId: params.organizationId,
      itemId: params.itemId,
      lotNumber,
      quantity,
      receivedAt,
    })
    .returning({
      id: lots.id,
      lotNumber: lots.lotNumber,
      receivedAt: lots.receivedAt,
    });

  const [event] = await insertInventoryEventsInTx(tx, [
    {
      organizationId: params.organizationId,
      locationId: params.locationId,
      eventType: params.eventType,
      eventSubtype: params.eventSubtype ?? null,
      itemId: params.itemId,
      lotId: lot.id,
      quantity,
      unitCost,
      extendedCost,
      disposition,
      toDisposition: disposition,
      referenceType: params.referenceType ?? null,
      referenceId: params.referenceId ?? null,
      actorUserId: params.actorUserId ?? null,
      idempotencyKey: params.idempotencyKey ?? null,
      occurredAt: params.occurredAt,
      metadata: {
        lotNumber,
        ...(params.metadata ?? {}),
      },
    },
  ]);

  await applyLotBalanceDeltasInTx(tx, [
    {
      organizationId: params.organizationId,
      locationId: params.locationId,
      lotId: lot.id,
      itemId: params.itemId,
      disposition,
      quantityDelta: parseFloat(quantity),
      unitCost,
      receivedAt: lot.receivedAt,
      originEventId: event.id,
    },
  ]);

  await applyItemBalanceDeltasInTx(tx, [
    {
      organizationId: params.organizationId,
      locationId: params.locationId,
      itemId: params.itemId,
      onHandDelta: parseFloat(quantity),
    },
  ]);

  return {
    eventId: event.id,
    lotId: lot.id,
    lotNumber: lot.lotNumber,
  };
}

async function getLockedFifoLotsInTx(
  tx: Tx,
  params: { organizationId: string; locationId: string; itemId: string }
) {
  return tx
    .select({
      lotId: lots.id,
      lotNumber: lots.lotNumber,
      quantity: inventoryLotBalances.quantity,
      unitCost: inventoryLotBalances.unitCost,
      receivedAt: inventoryLotBalances.receivedAt,
    })
    .from(inventoryLotBalances)
    .innerJoin(
      lots,
      eq(lots.id, inventoryLotBalances.lotId)
    )
    .where(
      and(
        eq(inventoryLotBalances.organizationId, params.organizationId),
        eq(inventoryLotBalances.locationId, params.locationId),
        eq(inventoryLotBalances.itemId, params.itemId),
        eq(inventoryLotBalances.disposition, DEFAULT_DISPOSITION),
        sql`${inventoryLotBalances.quantity} > 0`
      )
    )
    .orderBy(asc(inventoryLotBalances.receivedAt), asc(inventoryLotBalances.lotId))
    .for("update");
}

export async function consumeStockFifoInTx(
  tx: Tx,
  params: {
    organizationId: string;
    locationId: string;
    itemId: string;
    quantity: number;
    eventType: NegativeStockEventType;
    eventSubtype?: string | null;
    referenceType?: string | null;
    referenceId?: string | null;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    occurredAt?: Date;
    metadata?: Record<string, unknown> | null;
  }
) {
  await lockItemsInTx(tx, [params.itemId]);

  const lotsForUpdate = await getLockedFifoLotsInTx(tx, params);
  const totalAvailable = lotsForUpdate.reduce(
    (sum, lot) => sum + parseFloat(lot.quantity),
    0
  );

  if (totalAvailable < params.quantity) {
    throw new InsufficientStockError({
      itemId: params.itemId,
      available: totalAvailable,
      requested: params.quantity,
    });
  }

  let remaining = roundQuantity(params.quantity);
  const allocations: FifoAllocation[] = [];

  for (const lot of lotsForUpdate) {
    if (remaining <= 0) {
      break;
    }

    const currentQty = parseFloat(lot.quantity);
    const unitCost = parseFloat(lot.unitCost ?? "0");
    const receivedAt = lot.receivedAt ?? new Date();
    const deduction = roundQuantity(Math.min(currentQty, remaining));

    const [updatedBalance] = await tx
      .update(inventoryLotBalances)
      .set({
        quantity: sql`${inventoryLotBalances.quantity} - ${deduction}`,
        stillActive: sql`(${inventoryLotBalances.quantity} - ${deduction}) > 0`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(inventoryLotBalances.organizationId, params.organizationId),
          eq(inventoryLotBalances.itemId, params.itemId),
          eq(inventoryLotBalances.locationId, params.locationId),
          eq(inventoryLotBalances.lotId, lot.lotId),
          eq(inventoryLotBalances.disposition, DEFAULT_DISPOSITION),
          sql`${inventoryLotBalances.quantity} >= ${deduction}`
        )
      )
      .returning({ lotId: inventoryLotBalances.lotId });

    if (!updatedBalance) {
      throw new InsufficientStockError({
        itemId: params.itemId,
        available: totalAvailable,
        requested: params.quantity,
      });
    }

    await tx
      .update(lots)
      .set({
        quantity: sql`${lots.quantity} - ${deduction}`,
        updatedAt: new Date(),
      })
      .where(eq(lots.id, lot.lotId));

    allocations.push({
      lotId: lot.lotId,
      lotNumber: lot.lotNumber,
      quantity: deduction,
      unitCost,
      receivedAt,
    });
    remaining = roundQuantity(remaining - deduction);
  }

  const inserted = await insertInventoryEventsInTx(
    tx,
    allocations.map((allocation, index) => ({
      organizationId: params.organizationId,
      locationId: params.locationId,
      eventType: params.eventType,
      eventSubtype: params.eventSubtype ?? null,
      itemId: params.itemId,
      lotId: allocation.lotId,
      quantity: normalizeNumeric(allocation.quantity),
      unitCost: normalizeNumericScale(allocation.unitCost, 6),
      extendedCost: normalizeNumericScale(
        allocation.quantity * allocation.unitCost,
        6
      ),
      disposition: DEFAULT_DISPOSITION,
      fromDisposition: DEFAULT_DISPOSITION,
      referenceType: params.referenceType ?? null,
      referenceId: params.referenceId ?? null,
      actorUserId: params.actorUserId ?? null,
      idempotencyKey: index === 0 ? params.idempotencyKey ?? null : null,
      occurredAt: params.occurredAt,
      metadata: params.metadata ?? null,
    }))
  );

  await applyItemBalanceDeltasInTx(tx, [
    {
      organizationId: params.organizationId,
      locationId: params.locationId,
      itemId: params.itemId,
      onHandDelta: -roundQuantity(params.quantity),
    },
  ]);

  return {
    allocations,
    eventIds: inserted.map((row) => row.id),
  };
}

export async function restockExistingLotInTx(
  tx: Tx,
  params: {
    organizationId: string;
    locationId: string;
    itemId: string;
    lotId: string;
    quantity: number;
    unitCost: string;
    eventType?: RestockEventType;
    eventSubtype?: string | null;
    referenceType?: string | null;
    referenceId?: string | null;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    occurredAt?: Date;
    parentEventId?: string | null;
    metadata?: Record<string, unknown> | null;
    disposition?: InventoryDisposition;
  }
) {
  await lockItemsInTx(tx, [params.itemId]);
  const disposition = params.disposition ?? DEFAULT_DISPOSITION;

  await tx
    .update(lots)
    .set({
      quantity: sql`${lots.quantity} + ${params.quantity}`,
      updatedAt: new Date(),
    })
    .where(eq(lots.id, params.lotId));

  const [event] = await insertInventoryEventsInTx(tx, [
    {
      organizationId: params.organizationId,
      locationId: params.locationId,
      eventType: params.eventType ?? "unpick_restock",
      eventSubtype: params.eventSubtype ?? null,
      itemId: params.itemId,
      lotId: params.lotId,
      quantity: normalizeNumeric(params.quantity),
      unitCost: normalizeNumericScale(parseFloat(params.unitCost), 6),
      extendedCost: normalizeNumericScale(
        params.quantity * parseFloat(params.unitCost),
        6
      ),
      disposition,
      toDisposition: disposition,
      referenceType: params.referenceType ?? null,
      referenceId: params.referenceId ?? null,
      parentEventId: params.parentEventId ?? null,
      actorUserId: params.actorUserId ?? null,
      idempotencyKey: params.idempotencyKey ?? null,
      occurredAt: params.occurredAt,
      metadata: params.metadata ?? null,
    },
  ]);

  await applyLotBalanceDeltasInTx(tx, [
    {
      organizationId: params.organizationId,
      locationId: params.locationId,
      lotId: params.lotId,
      itemId: params.itemId,
      disposition,
      quantityDelta: params.quantity,
    },
  ]);

  await applyItemBalanceDeltasInTx(tx, [
    {
      organizationId: params.organizationId,
      locationId: params.locationId,
      itemId: params.itemId,
      onHandDelta: params.quantity,
    },
  ]);

  return { eventId: event.id };
}

export async function decrementPhysicalLotQuantityInTx(
  tx: Tx,
  params: {
    organizationId: string;
    itemId: string;
    lotId: string;
    quantity: number;
  }
) {
  const [updated] = await tx
    .update(lots)
    .set({
      quantity: sql`${lots.quantity} - ${params.quantity}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(lots.organizationId, params.organizationId),
        eq(lots.itemId, params.itemId),
        eq(lots.id, params.lotId),
        sql`${lots.quantity} >= ${params.quantity}`
      )
    )
    .returning({ id: lots.id });

  return updated != null;
}
