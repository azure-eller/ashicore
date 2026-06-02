import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { roundQuantity } from "@/lib/format";
import {
  inventoryDemandSummary,
  inventoryLotBalances,
  inventoryReservationsSummary,
  manufacturingOrderOutputs,
  manufacturingOrders,
  salesOrderLines,
} from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import {
  InsufficientStockError,
  LinkedManufacturingOutputUnavailableError,
} from "@/lib/inventory/kernel/errors";
import { lockItemsInTx } from "@/lib/inventory/kernel/locking";
import { getDefaultInventoryLocationInTx } from "@/lib/inventory/kernel/locations";
import {
  applyDemandReferenceDeltasInTx,
  applyReservationReferenceDeltasInTx,
  beginInventoryOperationInTx,
  finishInventoryOperationInTx,
} from "@/lib/inventory/kernel/operations/common";
import {
  consumeStockFifoInTx,
  consumeSpecificLotInTx,
  getCurrentAvailableQtyAtLocationInTx,
} from "@/lib/inventory/kernel/operations/stock-core";

async function consumeLinkedManufacturingOutputForSalesLineInTx(
  tx: Tx,
  params: {
    organizationId: string;
    locationId: string;
    salesOrderLineId: string;
    itemId: string;
    quantity: number;
    eventType: "sales_consumption";
    eventSubtype: "sales_ship";
    referenceType: "sales_order";
    referenceId: string;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    occurredAt?: Date;
    metadata?: Record<string, unknown> | null;
    unavailableByLotId?: Map<string, number>;
  }
) {
  const linkedOrders = await tx
    .select({ id: manufacturingOrders.id })
    .from(manufacturingOrders)
    .where(
      and(
        eq(manufacturingOrders.organizationId, params.organizationId),
        eq(manufacturingOrders.productId, params.itemId),
        eq(manufacturingOrders.salesOrderLineId, params.salesOrderLineId),
        sql`${manufacturingOrders.deletedAt} IS NULL`,
        sql`${manufacturingOrders.status} <> 'cancelled'`
      )
    );
  const linkedOrderIds = linkedOrders.map((order) => order.id);

  const outputLots = await tx
    .select({
      lotId: manufacturingOrderOutputs.lotId,
    })
    .from(manufacturingOrderOutputs)
    .innerJoin(
      manufacturingOrders,
      eq(manufacturingOrders.id, manufacturingOrderOutputs.manufacturingOrderId)
    )
    .where(
      and(
        linkedOrderIds.length > 0
          ? inArray(manufacturingOrderOutputs.manufacturingOrderId, linkedOrderIds)
          : sql`false`,
        eq(manufacturingOrderOutputs.disposition, "available"),
        sql`${manufacturingOrderOutputs.quantity} > 0`
      )
    )
    .orderBy(
      asc(manufacturingOrderOutputs.outputNumber),
      asc(manufacturingOrderOutputs.createdAt),
      asc(manufacturingOrderOutputs.lotId)
    );

  let remaining = roundQuantity(params.quantity);
  const eventIds: string[] = [];
  let idempotencyUsed = false;
  const seenLotIds = new Set<string>();

  for (const output of outputLots) {
    if (remaining <= 0) break;
    if (seenLotIds.has(output.lotId)) continue;
    seenLotIds.add(output.lotId);

    const [balance] = await tx
      .select({ quantity: inventoryLotBalances.quantity })
      .from(inventoryLotBalances)
      .where(
        and(
          eq(inventoryLotBalances.organizationId, params.organizationId),
          eq(inventoryLotBalances.locationId, params.locationId),
          eq(inventoryLotBalances.itemId, params.itemId),
          eq(inventoryLotBalances.lotId, output.lotId),
          eq(inventoryLotBalances.disposition, "available"),
          sql`${inventoryLotBalances.quantity} > 0`
        )
      )
      .for("update");
    const protectedQty = params.unavailableByLotId?.get(output.lotId) ?? 0;
    const usableQty = roundQuantity(
      Math.max(0, parseFloat(balance?.quantity ?? "0") - protectedQty)
    );
    const consumedQty = roundQuantity(Math.min(remaining, usableQty));
    if (consumedQty <= 0) continue;

    const consumed = await consumeSpecificLotInTx(tx, {
      organizationId: params.organizationId,
      locationId: params.locationId,
      itemId: params.itemId,
      lotId: output.lotId,
      quantity: consumedQty,
      eventType: params.eventType,
      eventSubtype: params.eventSubtype,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      actorUserId: params.actorUserId ?? null,
      idempotencyKey: !idempotencyUsed ? params.idempotencyKey ?? null : null,
      occurredAt: params.occurredAt,
      metadata: params.metadata ?? null,
    });
    eventIds.push(...consumed.eventIds);
    idempotencyUsed = idempotencyUsed || consumed.eventIds.length > 0;
    remaining = roundQuantity(remaining - consumedQty);
  }

  return {
    hasLinkedManufacturingOrder: linkedOrderIds.length > 0,
    eventIds,
    remainingQuantity: remaining,
    idempotencyUsed,
  };
}

export async function reserveForSalesInTx(
  tx: Tx,
  params: {
    organizationId: string;
    salesOrderId: string;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    lines: Array<{
      salesOrderLineId: string;
      itemId: string;
      quantity: number;
    }>;
  }
) {
  const replay = await beginInventoryOperationInTx<{ referenceIds: string[] }>(tx, {
    organizationId: params.organizationId,
    operationName: "reserveForSales",
    idempotencyKey: params.idempotencyKey ?? null,
    payload: {
      salesOrderId: params.salesOrderId,
      lines: params.lines,
    },
  });

  if (replay.replayed) {
    return replay.result;
  }

  if (params.lines.length === 0) {
    const result = { referenceIds: [] };
    await finishInventoryOperationInTx(tx, {
      organizationId: params.organizationId,
      idempotencyKey: params.idempotencyKey ?? null,
      result,
    });
    return result;
  }

  const location = await getDefaultInventoryLocationInTx(tx, params.organizationId);
  const deltas = params.lines.map((line) => ({
    itemId: line.itemId,
    referenceType: "sales_order_line",
    referenceId: line.salesOrderLineId,
    quantity: line.quantity,
  }));
  const demandEvents = await applyDemandReferenceDeltasInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    actorUserId: params.actorUserId ?? null,
    idempotencyKey: params.idempotencyKey ?? null,
    eventSubtype: "sales_confirm",
    deltas,
  });
  const availableByItem = new Map<string, number>();
  const reservationLines: typeof deltas = [];

  const lineIds = params.lines.map((line) => line.salesOrderLineId);
  const existingReservationRows =
    lineIds.length > 0
      ? await tx
          .select({
            referenceId: inventoryReservationsSummary.referenceId,
            quantity: inventoryReservationsSummary.quantity,
          })
          .from(inventoryReservationsSummary)
          .where(
            and(
              eq(inventoryReservationsSummary.organizationId, params.organizationId),
              eq(inventoryReservationsSummary.locationId, location.id),
              eq(inventoryReservationsSummary.referenceType, "sales_order_line"),
              inArray(inventoryReservationsSummary.referenceId, lineIds)
            )
          )
      : [];
  const existingReservationByLineId = new Map(
    existingReservationRows.map((row) => [row.referenceId, parseFloat(row.quantity)])
  );

  for (const line of params.lines) {
    if (!availableByItem.has(line.itemId)) {
      availableByItem.set(
        line.itemId,
        await getCurrentAvailableQtyAtLocationInTx(tx, {
          organizationId: params.organizationId,
          locationId: location.id,
          itemId: line.itemId,
        })
      );
    }

    const available = availableByItem.get(line.itemId) ?? 0;
    const existingReservation =
      existingReservationByLineId.get(line.salesOrderLineId) ?? 0;
    // Allocations preserved across an edit leave a non-zero reservation for the line.
    // Add only the delta needed to reach line.quantity so we never double-reserve.
    const reserveDelta = roundQuantity(
      Math.min(Math.max(line.quantity - existingReservation, 0), Math.max(available, 0))
    );
    if (reserveDelta > 0) {
      reservationLines.push({
        itemId: line.itemId,
        referenceType: "sales_order_line",
        referenceId: line.salesOrderLineId,
        quantity: reserveDelta,
      });
      availableByItem.set(line.itemId, roundQuantity(available - reserveDelta));
      existingReservationByLineId.set(
        line.salesOrderLineId,
        roundQuantity(existingReservation + reserveDelta)
      );
    }
  }

  const reservationEvents =
    reservationLines.length > 0
      ? await applyReservationReferenceDeltasInTx(tx, {
          organizationId: params.organizationId,
          locationId: location.id,
          actorUserId: params.actorUserId ?? null,
          eventSubtype: "sales_confirm",
          deltas: reservationLines,
        })
      : [];
  const result = { referenceIds: params.lines.map((line) => line.salesOrderLineId) };

  await finishInventoryOperationInTx(tx, {
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey ?? null,
    firstEventId: demandEvents[0]?.id ?? reservationEvents[0]?.id ?? null,
    result,
  });

  return result;
}

export async function recordSalesDemandAndReservationsInTx(
  tx: Tx,
  params: {
    organizationId: string;
    salesOrderId: string;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    demandLines: Array<{
      salesOrderLineId: string;
      itemId: string;
      quantity: number;
    }>;
    reservationLines: Array<{
      salesOrderLineId: string;
      itemId: string;
      quantity: number;
    }>;
  }
) {
  const replay = await beginInventoryOperationInTx<{ referenceIds: string[] }>(tx, {
    organizationId: params.organizationId,
    operationName: "recordSalesDemandAndReservations",
    idempotencyKey: params.idempotencyKey ?? null,
    payload: {
      salesOrderId: params.salesOrderId,
      demandLines: params.demandLines,
      reservationLines: params.reservationLines,
    },
  });

  if (replay.replayed) {
    return replay.result;
  }

  if (params.demandLines.length === 0 && params.reservationLines.length === 0) {
    const result = { referenceIds: [] };
    await finishInventoryOperationInTx(tx, {
      organizationId: params.organizationId,
      idempotencyKey: params.idempotencyKey ?? null,
      result,
    });
    return result;
  }

  const location = await getDefaultInventoryLocationInTx(tx, params.organizationId);
  const demandEvents = await applyDemandReferenceDeltasInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    actorUserId: params.actorUserId ?? null,
    idempotencyKey: params.idempotencyKey ?? null,
    eventSubtype: "sales_confirm",
    deltas: params.demandLines.map((line) => ({
      itemId: line.itemId,
      referenceType: "sales_order_line",
      referenceId: line.salesOrderLineId,
      quantity: line.quantity,
    })),
  });
  const reservationEvents = await applyReservationReferenceDeltasInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    actorUserId: params.actorUserId ?? null,
    eventSubtype: "sales_confirm",
    deltas: params.reservationLines.map((line) => ({
      itemId: line.itemId,
      referenceType: "sales_order_line",
      referenceId: line.salesOrderLineId,
      quantity: line.quantity,
    })),
  });

  const result = {
    referenceIds: [
      ...new Set([
        ...params.demandLines.map((line) => line.salesOrderLineId),
        ...params.reservationLines.map((line) => line.salesOrderLineId),
      ]),
    ],
  };

  await finishInventoryOperationInTx(tx, {
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey ?? null,
    firstEventId: demandEvents[0]?.id ?? reservationEvents[0]?.id ?? null,
    result,
  });

  return result;
}

export async function setSalesLineStockReservationInTx(
  tx: Tx,
  params: {
    organizationId: string;
    salesOrderLineId: string;
    itemId: string;
    quantity: number;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    eventSubtype?: "sales_confirm" | "sales_allocation";
  }
) {
  const replay = await beginInventoryOperationInTx<{ referenceIds: string[] }>(tx, {
    organizationId: params.organizationId,
    operationName: "setSalesLineStockReservation",
    idempotencyKey: params.idempotencyKey ?? null,
    payload: {
      salesOrderLineId: params.salesOrderLineId,
      itemId: params.itemId,
      quantity: params.quantity,
    },
  });

  if (replay.replayed) {
    return replay.result;
  }

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
  const currentQty = parseFloat(existingReservation?.quantity ?? "0");
  const deltaQty = roundQuantity(params.quantity - currentQty);
  const reservationEvents =
    deltaQty === 0
      ? []
      : await applyReservationReferenceDeltasInTx(tx, {
          organizationId: params.organizationId,
          locationId: location.id,
          actorUserId: params.actorUserId ?? null,
          eventSubtype: params.eventSubtype ?? "sales_allocation",
          deltas: [
            {
              itemId: params.itemId,
              referenceType: "sales_order_line",
              referenceId: params.salesOrderLineId,
              quantity: deltaQty,
            },
          ],
        });

  const result = { referenceIds: [params.salesOrderLineId] };
  await finishInventoryOperationInTx(tx, {
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey ?? null,
    firstEventId: reservationEvents[0]?.id ?? null,
    result,
  });

  return result;
}

export async function releaseReservationForSalesLineInTx(
  tx: Tx,
  params: {
    organizationId: string;
    salesOrderId: string;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    reason: "cancelled" | "shipped" | "edited" | "deleted";
    salesOrderLineIds: string[];
  }
) {
  const replay = await beginInventoryOperationInTx<{ referenceIds: string[] }>(tx, {
    organizationId: params.organizationId,
    operationName: "releaseReservationForSalesLine",
    idempotencyKey: params.idempotencyKey ?? null,
    payload: {
      salesOrderId: params.salesOrderId,
      reason: params.reason,
      salesOrderLineIds: params.salesOrderLineIds,
    },
  });

  if (replay.replayed) {
    return replay.result;
  }

  if (params.salesOrderLineIds.length === 0) {
    const result = { referenceIds: [] };
    await finishInventoryOperationInTx(tx, {
      organizationId: params.organizationId,
      idempotencyKey: params.idempotencyKey ?? null,
      result,
    });
    return result;
  }

  const location = await getDefaultInventoryLocationInTx(tx, params.organizationId);
  const existingReservationRows = await tx
    .select({
      itemId: inventoryReservationsSummary.itemId,
      referenceId: inventoryReservationsSummary.referenceId,
      quantity: inventoryReservationsSummary.quantity,
    })
    .from(inventoryReservationsSummary)
    .where(
      and(
        eq(inventoryReservationsSummary.organizationId, params.organizationId),
        eq(inventoryReservationsSummary.locationId, location.id),
        eq(inventoryReservationsSummary.referenceType, "sales_order_line"),
        inArray(inventoryReservationsSummary.referenceId, params.salesOrderLineIds)
      )
    );
  const existingDemandRows = await tx
    .select({
      itemId: inventoryDemandSummary.itemId,
      referenceId: inventoryDemandSummary.referenceId,
      quantity: inventoryDemandSummary.quantity,
    })
    .from(inventoryDemandSummary)
    .where(
      and(
        eq(inventoryDemandSummary.organizationId, params.organizationId),
        eq(inventoryDemandSummary.locationId, location.id),
        eq(inventoryDemandSummary.referenceType, "sales_order_line"),
        inArray(inventoryDemandSummary.referenceId, params.salesOrderLineIds)
      )
    );

  const demandEvents = await applyDemandReferenceDeltasInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    actorUserId: params.actorUserId ?? null,
    idempotencyKey: params.idempotencyKey ?? null,
    eventSubtype: params.reason,
    deltas: existingDemandRows.map((row) => ({
      itemId: row.itemId,
      referenceType: "sales_order_line",
      referenceId: row.referenceId,
      quantity: -parseFloat(row.quantity),
    })),
  });

  const reservationEvents = await applyReservationReferenceDeltasInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    actorUserId: params.actorUserId ?? null,
    eventSubtype: params.reason,
    deltas: existingReservationRows.map((row) => ({
      itemId: row.itemId,
      referenceType: "sales_order_line",
      referenceId: row.referenceId,
      quantity: -parseFloat(row.quantity),
    })),
  });

  const result = {
    referenceIds: [
      ...new Set([
        ...existingDemandRows.map((row) => row.referenceId),
        ...existingReservationRows.map((row) => row.referenceId),
      ]),
    ],
  };

  await finishInventoryOperationInTx(tx, {
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey ?? null,
    firstEventId: demandEvents[0]?.id ?? reservationEvents[0]?.id ?? null,
    result,
  });

  return result;
}

export async function releaseReservationForSalesQuantitiesInTx(
  tx: Tx,
  params: {
    organizationId: string;
    salesOrderId: string;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    reason: "cancelled" | "shipped" | "edited" | "deleted";
    lines: Array<{
      salesOrderLineId: string;
      itemId: string;
      quantity: number;
    }>;
  }
) {
  const replay = await beginInventoryOperationInTx<{ referenceIds: string[] }>(tx, {
    organizationId: params.organizationId,
    operationName: "releaseReservationForSalesQuantities",
    idempotencyKey: params.idempotencyKey ?? null,
    payload: {
      salesOrderId: params.salesOrderId,
      reason: params.reason,
      lines: params.lines,
    },
  });

  if (replay.replayed) {
    return replay.result;
  }

  const location = await getDefaultInventoryLocationInTx(tx, params.organizationId);
  const deltas = params.lines.map((line) => ({
    itemId: line.itemId,
    referenceType: "sales_order_line",
    referenceId: line.salesOrderLineId,
    quantity: -line.quantity,
  }));
  const demandEvents = await applyDemandReferenceDeltasInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    actorUserId: params.actorUserId ?? null,
    idempotencyKey: params.idempotencyKey ?? null,
    eventSubtype: params.reason,
    deltas,
  });
  const reservationEvents = await applyReservationReferenceDeltasInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    actorUserId: params.actorUserId ?? null,
    eventSubtype: params.reason,
    deltas,
  });

  const result = { referenceIds: params.lines.map((line) => line.salesOrderLineId) };

  await finishInventoryOperationInTx(tx, {
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey ?? null,
    firstEventId: demandEvents[0]?.id ?? reservationEvents[0]?.id ?? null,
    result,
  });

  return result;
}

export async function consumeForSalesOrderShippingInTx(
  tx: Tx,
  params: {
    organizationId: string;
    salesOrderId: string;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    shippedAt?: Date;
    allowNegativeStock?: boolean;
    lines: Array<{
      salesOrderLineId: string;
      itemId: string;
      quantity: number;
    }>;
  }
) {
  const replay = await beginInventoryOperationInTx<{
    eventIds: string[];
  }>(tx, {
    organizationId: params.organizationId,
    operationName: "consumeForSalesOrderShipping",
    idempotencyKey: params.idempotencyKey ?? null,
    payload: {
      salesOrderId: params.salesOrderId,
      lines: params.lines,
      shippedAt: params.shippedAt?.toISOString() ?? null,
    },
  });

  if (replay.replayed) {
    return replay.result;
  }

  const location = await getDefaultInventoryLocationInTx(tx, params.organizationId);
  const eventIds: string[] = [];
  await lockItemsInTx(
    tx,
    params.lines.map((line) => line.itemId)
  );

  const existingReservationRows = await tx
    .select({
      itemId: inventoryReservationsSummary.itemId,
      referenceId: inventoryReservationsSummary.referenceId,
      quantity: inventoryReservationsSummary.quantity,
    })
    .from(inventoryReservationsSummary)
    .where(
      and(
        eq(inventoryReservationsSummary.organizationId, params.organizationId),
        eq(inventoryReservationsSummary.locationId, location.id),
        eq(inventoryReservationsSummary.referenceType, "sales_order_line"),
        inArray(
          inventoryReservationsSummary.referenceId,
          params.lines.map((line) => line.salesOrderLineId)
        )
      )
    );
  const reservedByLineId = new Map(
    existingReservationRows.map((row) => [row.referenceId, parseFloat(row.quantity)])
  );
  const availableByItem = new Map<string, number>();

  for (const line of params.lines) {
    const currentAvailable = availableByItem.get(line.itemId);
    const unreservedAvailable =
      currentAvailable ??
      await getCurrentAvailableQtyAtLocationInTx(tx, {
        organizationId: params.organizationId,
        locationId: location.id,
        itemId: line.itemId,
      });
    const ownReservation = reservedByLineId.get(line.salesOrderLineId) ?? 0;
    const selfAvailable = roundQuantity(unreservedAvailable + ownReservation);

    if (selfAvailable < line.quantity && !params.allowNegativeStock) {
      throw new InsufficientStockError({
        itemId: line.itemId,
        available: selfAvailable,
        requested: line.quantity,
      });
    }

    availableByItem.set(
      line.itemId,
      roundQuantity(unreservedAvailable - Math.max(0, line.quantity - ownReservation))
    );
  }

  for (const [index, line] of params.lines.entries()) {
    const metadata = {
      salesOrderId: params.salesOrderId,
      salesOrderLineId: line.salesOrderLineId,
    };
    let remaining = roundQuantity(line.quantity);

    let idempotencyUsed = false;

    if (remaining > 0) {
      const consumedLinkedOutput =
        await consumeLinkedManufacturingOutputForSalesLineInTx(tx, {
          organizationId: params.organizationId,
          locationId: location.id,
          salesOrderLineId: line.salesOrderLineId,
          itemId: line.itemId,
          quantity: remaining,
          eventType: "sales_consumption",
          eventSubtype: "sales_ship",
          referenceType: "sales_order",
          referenceId: params.salesOrderId,
          actorUserId: params.actorUserId ?? null,
          idempotencyKey:
            index === 0 && !idempotencyUsed ? params.idempotencyKey ?? null : null,
          occurredAt: params.shippedAt,
          metadata,
        });
      idempotencyUsed =
        idempotencyUsed || consumedLinkedOutput.idempotencyUsed;
      remaining = consumedLinkedOutput.remainingQuantity;
      eventIds.push(...consumedLinkedOutput.eventIds);

      if (remaining > 0 && consumedLinkedOutput.hasLinkedManufacturingOrder) {
        throw new LinkedManufacturingOutputUnavailableError({
          itemId: line.itemId,
          available: roundQuantity(line.quantity - remaining),
          requested: line.quantity,
        });
      }
    }

    if (remaining > 0) {
      const consumed = await consumeStockFifoInTx(tx, {
        organizationId: params.organizationId,
        locationId: location.id,
        itemId: line.itemId,
        quantity: remaining,
        eventType: "sales_consumption",
        eventSubtype: "sales_ship",
        referenceType: "sales_order",
        referenceId: params.salesOrderId,
        actorUserId: params.actorUserId ?? null,
        idempotencyKey:
          index === 0 && !idempotencyUsed ? params.idempotencyKey ?? null : null,
        occurredAt: params.shippedAt,
        metadata,
        allowNegativeStock: params.allowNegativeStock ?? false,
      });
      eventIds.push(...consumed.eventIds);
    }
  }

  await applyDemandReferenceDeltasInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    actorUserId: params.actorUserId ?? null,
    eventSubtype: "shipped",
    deltas: params.lines.map((line) => ({
      itemId: line.itemId,
      referenceType: "sales_order_line",
      referenceId: line.salesOrderLineId,
      quantity: -line.quantity,
    })),
  });

  await applyReservationReferenceDeltasInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    actorUserId: params.actorUserId ?? null,
    eventSubtype: "shipped",
    deltas: params.lines.map((line) => ({
      itemId: line.itemId,
      referenceType: "sales_order_line",
      referenceId: line.salesOrderLineId,
      quantity: -line.quantity,
    })),
  });

  const result = { eventIds };

  await finishInventoryOperationInTx(tx, {
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey ?? null,
    firstEventId: eventIds[0] ?? null,
    result,
  });

  return result;
}

export async function getSalesLineQuantitiesForReservationInTx(
  tx: Tx,
  salesOrderId: string
) {
  return tx
    .select({
      salesOrderLineId: salesOrderLines.id,
      itemId: salesOrderLines.itemId,
      quantity: salesOrderLines.quantity,
    })
    .from(salesOrderLines)
    .where(eq(salesOrderLines.salesOrderId, salesOrderId));
}
