import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { normalizeNumeric, roundQuantity } from "@/lib/format";
import {
  inventoryLotBalances,
  inventoryReservationsSummary,
  manufacturingOrderIngredients,
  manufacturingOrderOutputs,
  salesOrders,
  salesOrderLines,
  salesShipmentLines,
  salesShipments,
  stockAllocations,
  STOCK_ALLOCATION_DEMAND_TYPES,
  type StockAllocationDemandType,
} from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { getDefaultInventoryLocationInTx } from "@/lib/inventory/kernel/locations";
import { applyReservationReferenceDeltasInTx } from "./common";
import { consumeSpecificLotInTx } from "./stock-core";

function quantityString(value: number) {
  return normalizeNumeric(roundQuantity(Math.max(0, value)));
}

function isStockAllocationDemandType(value: string): value is StockAllocationDemandType {
  return (STOCK_ALLOCATION_DEMAND_TYPES as readonly string[]).includes(value);
}

async function reduceOrCloseAllocationInTx(
  tx: Tx,
  params: {
    allocationId: string;
    currentQuantity: string;
    consumedQuantity: number;
    statusWhenClosed: "consumed" | "cancelled";
    actorUserId?: string | null;
  }
) {
  const current = parseFloat(params.currentQuantity);
  const remaining = roundQuantity(current - params.consumedQuantity);
  const now = new Date();

  if (remaining > 0) {
    await tx
      .update(stockAllocations)
      .set({
        quantity: quantityString(remaining),
        updatedBy: params.actorUserId ?? null,
        updatedAt: now,
      })
      .where(eq(stockAllocations.id, params.allocationId));
    return;
  }

  await tx
    .update(stockAllocations)
    .set({
      status: params.statusWhenClosed,
      cancelledAt: params.statusWhenClosed === "cancelled" ? now : null,
      cancelledBy:
        params.statusWhenClosed === "cancelled" ? params.actorUserId ?? null : null,
      updatedBy: params.actorUserId ?? null,
      updatedAt: now,
    })
    .where(eq(stockAllocations.id, params.allocationId));
}

async function insertOrIncreaseLotAllocationInTx(
  tx: Tx,
  params: {
    organizationId: string;
    demandType: StockAllocationDemandType;
    demandId: string;
    itemId: string;
    lotId: string;
    quantity: number;
    actorUserId?: string | null;
  }
) {
  if (params.quantity <= 0) return;

  const [existing] = await tx
    .select({
      id: stockAllocations.id,
      quantity: stockAllocations.quantity,
    })
    .from(stockAllocations)
    .where(
      and(
        eq(stockAllocations.organizationId, params.organizationId),
        eq(stockAllocations.demandType, params.demandType),
        eq(stockAllocations.demandId, params.demandId),
        eq(stockAllocations.itemId, params.itemId),
        eq(stockAllocations.sourceType, "inventory_lot"),
        eq(stockAllocations.sourceId, params.lotId),
        eq(stockAllocations.status, "active")
      )
    )
    .for("update");

  const now = new Date();
  if (existing) {
    await tx
      .update(stockAllocations)
      .set({
        quantity: quantityString(parseFloat(existing.quantity) + params.quantity),
        updatedBy: params.actorUserId ?? null,
        updatedAt: now,
      })
      .where(eq(stockAllocations.id, existing.id));
    return;
  }

  await tx.insert(stockAllocations).values({
    organizationId: params.organizationId,
    demandType: params.demandType,
    demandId: params.demandId,
    itemId: params.itemId,
    sourceType: "inventory_lot",
    sourceId: params.lotId,
    quantity: quantityString(params.quantity),
    status: "active",
    createdBy: params.actorUserId ?? null,
    updatedBy: params.actorUserId ?? null,
  });
}

async function getActiveLotAllocationQtyForDemandInTx(
  tx: Tx,
  params: {
    organizationId: string;
    demandType: StockAllocationDemandType;
    demandId: string;
    itemId: string;
  }
) {
  const [row] = await tx
    .select({
      quantity: sql<string>`COALESCE(SUM(${stockAllocations.quantity}), 0)`,
    })
    .from(stockAllocations)
    .where(
      and(
        eq(stockAllocations.organizationId, params.organizationId),
        eq(stockAllocations.demandType, params.demandType),
        eq(stockAllocations.demandId, params.demandId),
        eq(stockAllocations.itemId, params.itemId),
        eq(stockAllocations.sourceType, "inventory_lot"),
        eq(stockAllocations.status, "active")
      )
    );

  return roundQuantity(parseFloat(row?.quantity ?? "0"));
}

async function syncSalesLineStockReservationFromLotAllocationsInTx(
  tx: Tx,
  params: {
    organizationId: string;
    salesOrderLineId: string;
    itemId: string;
    actorUserId?: string | null;
  }
) {
  const [line] = await tx
    .select({
      status: salesOrders.status,
    })
    .from(salesOrderLines)
    .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
    .where(
      and(
        eq(salesOrderLines.id, params.salesOrderLineId),
        eq(salesOrderLines.itemId, params.itemId)
      )
    );

  if (line?.status !== "open") {
    return;
  }

  const directInventoryLotAllocationQty = await getActiveLotAllocationQtyForDemandInTx(tx, {
    organizationId: params.organizationId,
    demandType: "sales_order_line",
    demandId: params.salesOrderLineId,
    itemId: params.itemId,
  });
  const [shipmentInventoryLotAllocation] = await tx
    .select({ quantity: sql<string>`COALESCE(SUM(${stockAllocations.quantity}), 0)` })
    .from(stockAllocations)
    .innerJoin(
      salesShipmentLines,
      eq(stockAllocations.demandId, salesShipmentLines.id)
    )
    .where(
      and(
        eq(stockAllocations.organizationId, params.organizationId),
        eq(stockAllocations.demandType, "sales_shipment_line"),
        eq(salesShipmentLines.salesOrderLineId, params.salesOrderLineId),
        eq(stockAllocations.itemId, params.itemId),
        eq(stockAllocations.sourceType, "inventory_lot"),
        eq(stockAllocations.status, "active")
      )
    );
  const inventoryLotAllocationQty = roundQuantity(
    directInventoryLotAllocationQty +
      parseFloat(shipmentInventoryLotAllocation?.quantity ?? "0")
  );

  const location = await getDefaultInventoryLocationInTx(tx, params.organizationId);
  const [existingReservation] = await tx
    .select({ quantity: inventoryReservationsSummary.quantity })
    .from(inventoryReservationsSummary)
    .where(
      and(
        eq(inventoryReservationsSummary.organizationId, params.organizationId),
        eq(inventoryReservationsSummary.locationId, location.id),
        eq(inventoryReservationsSummary.referenceType, "sales_order_line"),
        eq(inventoryReservationsSummary.referenceId, params.salesOrderLineId)
      )
    );
  const currentQty = roundQuantity(parseFloat(existingReservation?.quantity ?? "0"));
  const deltaQty = roundQuantity(inventoryLotAllocationQty - currentQty);
  if (deltaQty === 0) return;

  await applyReservationReferenceDeltasInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    actorUserId: params.actorUserId ?? null,
    eventSubtype: "sales_allocation",
    deltas: [
      {
        itemId: params.itemId,
        referenceType: "sales_order_line",
        referenceId: params.salesOrderLineId,
        quantity: deltaQty,
      },
    ],
  });
}

async function getOpenDemandQtyForAllocationInTx(
  tx: Tx,
  params: {
    organizationId: string;
    demandType: StockAllocationDemandType;
    demandId: string;
    itemId: string;
  }
) {
  let baseRemainingQty = 0;

  if (params.demandType === "sales_order_line") {
    const [line] = await tx
      .select({
        quantity: salesOrderLines.quantity,
        cancelledQuantity: salesOrderLines.cancelledQuantity,
      })
      .from(salesOrderLines)
      .where(
        and(
          eq(salesOrderLines.id, params.demandId),
          eq(salesOrderLines.itemId, params.itemId)
        )
      )
      .for("update");

    const [shipped] = await tx
      .select({
        quantity: sql<string>`COALESCE(SUM(${salesShipmentLines.quantity}), 0)`,
      })
      .from(salesShipmentLines)
      .innerJoin(salesShipments, eq(salesShipments.id, salesShipmentLines.salesShipmentId))
      .where(
        and(
          eq(salesShipmentLines.salesOrderLineId, params.demandId),
          eq(salesShipments.status, "shipped")
        )
      );

    baseRemainingQty = roundQuantity(
      Math.max(
        0,
        parseFloat(line?.quantity ?? "0") -
          parseFloat(line?.cancelledQuantity ?? "0") -
          parseFloat(shipped?.quantity ?? "0")
      )
    );
  } else if (params.demandType === "sales_shipment_line") {
    const [line] = await tx
      .select({
        quantity: salesShipmentLines.quantity,
      })
      .from(salesShipmentLines)
      .innerJoin(salesShipments, eq(salesShipments.id, salesShipmentLines.salesShipmentId))
      .innerJoin(salesOrders, eq(salesOrders.id, salesShipments.salesOrderId))
      .where(
        and(
          eq(salesShipmentLines.id, params.demandId),
          eq(salesShipmentLines.itemId, params.itemId),
          eq(salesShipments.status, "planned"),
          eq(salesOrders.status, "open")
        )
      )
      .for("update");

    baseRemainingQty = roundQuantity(parseFloat(line?.quantity ?? "0"));
  } else if (params.demandType === "manufacturing_order_ingredient") {
    const [ingredient] = await tx
      .select({
        remainingQty: sql<string>`GREATEST(
          ${manufacturingOrderIngredients.plannedQuantity}
          - GREATEST(
            ${manufacturingOrderIngredients.pickedQuantity},
            COALESCE(${manufacturingOrderIngredients.actualQuantity}, 0)
          ),
          0
        )`,
      })
      .from(manufacturingOrderIngredients)
      .where(
        and(
          eq(manufacturingOrderIngredients.id, params.demandId),
          eq(manufacturingOrderIngredients.itemId, params.itemId)
        )
      )
      .for("update");

    baseRemainingQty = roundQuantity(parseFloat(ingredient?.remainingQty ?? "0"));
  } else {
    throw new Error(`Unsupported stock allocation demand type: ${params.demandType}`);
  }

  const activeHeldQty = await getActiveLotAllocationQtyForDemandInTx(tx, params);
  return roundQuantity(Math.max(0, baseRemainingQty - activeHeldQty));
}

export async function getUnavailableLotAllocationQtyByLotIdInTx(
  tx: Tx,
  params: {
    organizationId: string;
    itemId: string;
    excludeDemand?: {
      demandType: StockAllocationDemandType;
      demandId: string;
    } | null;
  }
) {
  const rows = await tx
    .select({
      demandType: stockAllocations.demandType,
      demandId: stockAllocations.demandId,
      lotId: stockAllocations.sourceId,
      quantity: stockAllocations.quantity,
    })
    .from(stockAllocations)
    .where(
      and(
        eq(stockAllocations.organizationId, params.organizationId),
        eq(stockAllocations.itemId, params.itemId),
        eq(stockAllocations.sourceType, "inventory_lot"),
        eq(stockAllocations.status, "active")
      )
    );

  const unavailableByLotId = new Map<string, number>();
  for (const row of rows) {
    if (!row.lotId) continue;
    if (
      params.excludeDemand &&
      row.demandType === params.excludeDemand.demandType &&
      row.demandId === params.excludeDemand.demandId
    ) {
      continue;
    }

    unavailableByLotId.set(
      row.lotId,
      roundQuantity((unavailableByLotId.get(row.lotId) ?? 0) + parseFloat(row.quantity))
    );
  }

  return unavailableByLotId;
}

export async function consumeLotAllocationsForDemandInTx(
  tx: Tx,
  params: {
    organizationId: string;
    locationId: string;
    demandType: StockAllocationDemandType;
    demandId: string;
    itemId: string;
    quantity: number;
    eventType: Parameters<typeof consumeSpecificLotInTx>[1]["eventType"];
    eventSubtype?: string | null;
    referenceType?: string | null;
    referenceId?: string | null;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    occurredAt?: Date;
    metadata?: Record<string, unknown> | null;
  }
) {
  const rows = await tx
    .select({
      id: stockAllocations.id,
      sourceId: stockAllocations.sourceId,
      quantity: stockAllocations.quantity,
    })
    .from(stockAllocations)
    .where(
      and(
        eq(stockAllocations.organizationId, params.organizationId),
        eq(stockAllocations.demandType, params.demandType),
        eq(stockAllocations.demandId, params.demandId),
        eq(stockAllocations.itemId, params.itemId),
        eq(stockAllocations.sourceType, "inventory_lot"),
        eq(stockAllocations.status, "active")
      )
    )
    .orderBy(asc(stockAllocations.createdAt), asc(stockAllocations.id))
    .for("update");

  let remaining = roundQuantity(params.quantity);
  const eventIds: string[] = [];
  const allocations: Awaited<ReturnType<typeof consumeSpecificLotInTx>>["allocations"] = [];
  let idempotencyUsed = false;

  for (const row of rows) {
    if (remaining <= 0) break;
    if (!row.sourceId) continue;

    const quantity = roundQuantity(Math.min(remaining, parseFloat(row.quantity)));
    if (quantity <= 0) continue;

    const consumed = await consumeSpecificLotInTx(tx, {
      organizationId: params.organizationId,
      locationId: params.locationId,
      itemId: params.itemId,
      lotId: row.sourceId,
      quantity,
      eventType: params.eventType,
      eventSubtype: params.eventSubtype ?? null,
      referenceType: params.referenceType ?? null,
      referenceId: params.referenceId ?? null,
      actorUserId: params.actorUserId ?? null,
      idempotencyKey: !idempotencyUsed ? params.idempotencyKey ?? null : null,
      occurredAt: params.occurredAt,
      metadata: params.metadata ?? null,
    });

    idempotencyUsed = idempotencyUsed || consumed.eventIds.length > 0;
    eventIds.push(...consumed.eventIds);
    allocations.push(...consumed.allocations);
    remaining = roundQuantity(remaining - quantity);

    await reduceOrCloseAllocationInTx(tx, {
      allocationId: row.id,
      currentQuantity: row.quantity,
      consumedQuantity: quantity,
      statusWhenClosed: "consumed",
      actorUserId: params.actorUserId ?? null,
    });
  }

  return {
    allocations,
    eventIds,
    consumedQuantity: roundQuantity(params.quantity - remaining),
    remainingQuantity: remaining,
    idempotencyUsed,
  };
}

export async function materializeManufacturingOrderSourceAllocationsForLotInTx(
  tx: Tx,
  params: {
    organizationId: string;
    sourceManufacturingOrderId: string;
    itemId: string;
    lotId: string;
    quantity: number;
    actorUserId?: string | null;
  }
) {
  let remainingOutputQty = roundQuantity(params.quantity);
  if (remainingOutputQty <= 0) return;

  const promises = await tx
    .select({
      id: stockAllocations.id,
      demandType: stockAllocations.demandType,
      demandId: stockAllocations.demandId,
      quantity: stockAllocations.quantity,
    })
    .from(stockAllocations)
    .where(
      and(
        eq(stockAllocations.organizationId, params.organizationId),
        eq(stockAllocations.itemId, params.itemId),
        eq(stockAllocations.sourceType, "manufacturing_order"),
        eq(stockAllocations.sourceId, params.sourceManufacturingOrderId),
        eq(stockAllocations.status, "active")
      )
    )
    .orderBy(asc(stockAllocations.createdAt), asc(stockAllocations.id))
    .for("update");
  const salesLinesToSync = new Set<string>();

  for (const promise of promises) {
    if (remainingOutputQty <= 0) break;
    if (!isStockAllocationDemandType(promise.demandType)) {
      throw new Error(`Unsupported stock allocation demand type: ${promise.demandType}`);
    }
    const demandType = promise.demandType;
    const promiseQty = roundQuantity(parseFloat(promise.quantity));
    const openDemandQty = await getOpenDemandQtyForAllocationInTx(tx, {
      organizationId: params.organizationId,
      demandType,
      demandId: promise.demandId,
      itemId: params.itemId,
    });
    const holdQty = roundQuantity(
      Math.min(remainingOutputQty, promiseQty, openDemandQty)
    );

    if (holdQty > 0) {
      await insertOrIncreaseLotAllocationInTx(tx, {
        organizationId: params.organizationId,
        demandType,
        demandId: promise.demandId,
        itemId: params.itemId,
        lotId: params.lotId,
        quantity: holdQty,
        actorUserId: params.actorUserId ?? null,
      });

      if (demandType === "sales_order_line") {
        salesLinesToSync.add(promise.demandId);
      } else if (demandType === "sales_shipment_line") {
        const [line] = await tx
          .select({ salesOrderLineId: salesShipmentLines.salesOrderLineId })
          .from(salesShipmentLines)
          .where(eq(salesShipmentLines.id, promise.demandId));
        if (line) salesLinesToSync.add(line.salesOrderLineId);
      }

      await reduceOrCloseAllocationInTx(tx, {
        allocationId: promise.id,
        currentQuantity: promise.quantity,
        consumedQuantity: holdQty,
        statusWhenClosed: "consumed",
        actorUserId: params.actorUserId ?? null,
      });
    }

    const remainingPromiseQty = roundQuantity(promiseQty - holdQty);
    const unmetDemandQty = roundQuantity(openDemandQty - holdQty);
    const excessPromiseQty = roundQuantity(
      Math.max(0, remainingPromiseQty - Math.max(0, unmetDemandQty))
    );

    if (excessPromiseQty > 0) {
      await reduceOrCloseAllocationInTx(tx, {
        allocationId: promise.id,
        currentQuantity:
          holdQty > 0 ? quantityString(remainingPromiseQty) : promise.quantity,
        consumedQuantity: excessPromiseQty,
        statusWhenClosed: "cancelled",
        actorUserId: params.actorUserId ?? null,
      });
    }

    remainingOutputQty = roundQuantity(remainingOutputQty - holdQty);
  }

  for (const salesOrderLineId of salesLinesToSync) {
    await syncSalesLineStockReservationFromLotAllocationsInTx(tx, {
      organizationId: params.organizationId,
      salesOrderLineId,
      itemId: params.itemId,
      actorUserId: params.actorUserId ?? null,
    });
  }
}

export async function materializeManufacturingOrderSourceAllocationsFromExistingOutputInTx(
  tx: Tx,
  params: {
    organizationId: string;
    sourceManufacturingOrderId: string;
    itemId: string;
    actorUserId?: string | null;
  }
) {
  const location = await getDefaultInventoryLocationInTx(tx, params.organizationId);
  const outputRows = await tx
    .select({
      lotId: manufacturingOrderOutputs.lotId,
      quantity: sql<string>`COALESCE(SUM(${manufacturingOrderOutputs.quantity}), 0)`,
      outputNumber: sql<number>`MIN(${manufacturingOrderOutputs.outputNumber})::int`,
      createdAt: sql<Date>`MIN(${manufacturingOrderOutputs.createdAt})`,
    })
    .from(manufacturingOrderOutputs)
    .where(
      and(
        eq(manufacturingOrderOutputs.manufacturingOrderId, params.sourceManufacturingOrderId),
        eq(manufacturingOrderOutputs.disposition, "available"),
        sql`${manufacturingOrderOutputs.quantity} > 0`
      )
    )
    .groupBy(manufacturingOrderOutputs.lotId)
    .orderBy(
      sql`MIN(${manufacturingOrderOutputs.outputNumber})`,
      sql`MIN(${manufacturingOrderOutputs.createdAt})`,
      manufacturingOrderOutputs.lotId
    );

  for (const output of outputRows) {
    const [activeLotAllocation] = await tx
      .select({
        quantity: sql<string>`COALESCE(SUM(${stockAllocations.quantity}), 0)`,
      })
      .from(stockAllocations)
      .where(
        and(
          eq(stockAllocations.organizationId, params.organizationId),
          eq(stockAllocations.itemId, params.itemId),
          eq(stockAllocations.sourceType, "inventory_lot"),
          eq(stockAllocations.sourceId, output.lotId),
          eq(stockAllocations.status, "active")
        )
      );
    const [balance] = await tx
      .select({
        quantity: sql<string>`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`,
      })
      .from(inventoryLotBalances)
      .where(
        and(
          eq(inventoryLotBalances.organizationId, params.organizationId),
          eq(inventoryLotBalances.locationId, location.id),
          eq(inventoryLotBalances.itemId, params.itemId),
          eq(inventoryLotBalances.lotId, output.lotId),
          eq(inventoryLotBalances.disposition, "available")
        )
      );
    const freeQty = roundQuantity(
      parseFloat(balance?.quantity ?? "0") -
        parseFloat(activeLotAllocation?.quantity ?? "0")
    );
    if (freeQty <= 0) continue;

    await materializeManufacturingOrderSourceAllocationsForLotInTx(tx, {
      organizationId: params.organizationId,
      sourceManufacturingOrderId: params.sourceManufacturingOrderId,
      itemId: params.itemId,
      lotId: output.lotId,
      quantity: freeQty,
      actorUserId: params.actorUserId ?? null,
    });
  }
}

export async function cancelActiveStockAllocationsInTx(
  tx: Tx,
  params: {
    organizationId: string;
    actorUserId?: string | null;
    demandType?: StockAllocationDemandType;
    demandIds?: string[];
    sourceType?: "inventory_lot" | "manufacturing_order";
    sourceId?: string | null;
  }
) {
  if (params.demandIds && params.demandIds.length === 0) {
    return;
  }

  const conditions = [
    eq(stockAllocations.organizationId, params.organizationId),
    eq(stockAllocations.status, "active"),
  ];
  if (params.demandType) conditions.push(eq(stockAllocations.demandType, params.demandType));
  if (params.demandIds && params.demandIds.length > 0) {
    conditions.push(inArray(stockAllocations.demandId, params.demandIds));
  }
  if (params.sourceType) conditions.push(eq(stockAllocations.sourceType, params.sourceType));
  if (params.sourceId !== undefined) {
    conditions.push(
      params.sourceId == null
        ? sql`${stockAllocations.sourceId} IS NULL`
        : eq(stockAllocations.sourceId, params.sourceId)
    );
  }

  const now = new Date();
  await tx
    .update(stockAllocations)
    .set({
      status: "cancelled",
      cancelledAt: now,
      cancelledBy: params.actorUserId ?? null,
      updatedBy: params.actorUserId ?? null,
      updatedAt: now,
    })
    .where(and(...conditions));
}
