import { and, eq, inArray } from "drizzle-orm";
import { roundQuantity } from "@/lib/format";
import {
  inventoryDemandSummary,
  inventoryReservationsSummary,
  salesOrderLines,
} from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { InsufficientStockError } from "@/lib/inventory/kernel/errors";
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
  getCurrentAvailableQtyAtLocationInTx,
} from "@/lib/inventory/kernel/operations/stock-core";

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
  const reservationEvents = await applyReservationReferenceDeltasInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    actorUserId: params.actorUserId ?? null,
    eventSubtype: "sales_confirm",
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

export async function consumeForShipmentInTx(
  tx: Tx,
  params: {
    organizationId: string;
    salesOrderId: string;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    shippedAt?: Date;
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
    operationName: "consumeForShipment",
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

    const unreservedAvailable = availableByItem.get(line.itemId) ?? 0;
    const ownReservation = reservedByLineId.get(line.salesOrderLineId) ?? 0;

    if (roundQuantity(unreservedAvailable + ownReservation) < line.quantity) {
      throw new InsufficientStockError({
        itemId: line.itemId,
        available: roundQuantity(unreservedAvailable + ownReservation),
        requested: line.quantity,
      });
    }

    availableByItem.set(
      line.itemId,
      roundQuantity(unreservedAvailable - Math.max(0, line.quantity - ownReservation))
    );
  }

  for (const [index, line] of params.lines.entries()) {
    const consumed = await consumeStockFifoInTx(tx, {
      organizationId: params.organizationId,
      locationId: location.id,
      itemId: line.itemId,
      quantity: line.quantity,
      eventType: "sales_consumption",
      eventSubtype: "sales_ship",
      referenceType: "sales_order",
      referenceId: params.salesOrderId,
      actorUserId: params.actorUserId ?? null,
      idempotencyKey: index === 0 ? params.idempotencyKey ?? null : null,
      occurredAt: params.shippedAt,
      metadata: { salesOrderLineId: line.salesOrderLineId },
    });
    eventIds.push(...consumed.eventIds);
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
    deltas: existingReservationRows.map((row) => ({
      itemId: row.itemId,
      referenceType: "sales_order_line",
      referenceId: row.referenceId,
      quantity: -parseFloat(row.quantity),
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
