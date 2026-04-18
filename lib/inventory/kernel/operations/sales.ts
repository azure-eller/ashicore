import { and, eq, inArray } from "drizzle-orm";
import { inventoryReservationsSummary, salesOrderLines } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { getDefaultInventoryLocationInTx } from "@/lib/inventory/kernel/locations";
import {
  applyReservationReferenceDeltasInTx,
  beginInventoryOperationInTx,
  finishInventoryOperationInTx,
} from "@/lib/inventory/kernel/operations/common";
import { consumeStockFifoInTx } from "@/lib/inventory/kernel/operations/stock-core";

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
  const events = await applyReservationReferenceDeltasInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    actorUserId: params.actorUserId ?? null,
    idempotencyKey: params.idempotencyKey ?? null,
    eventSubtype: "sales_confirm",
    deltas: params.lines.map((line) => ({
      itemId: line.itemId,
      referenceType: "sales_order_line",
      referenceId: line.salesOrderLineId,
      quantity: line.quantity,
    })),
  });

  const result = { referenceIds: params.lines.map((line) => line.salesOrderLineId) };

  await finishInventoryOperationInTx(tx, {
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey ?? null,
    firstEventId: events[0]?.id ?? null,
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
  const existingRows = await tx
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

  const events = await applyReservationReferenceDeltasInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    actorUserId: params.actorUserId ?? null,
    idempotencyKey: params.idempotencyKey ?? null,
    eventSubtype: params.reason,
    deltas: existingRows.map((row) => ({
      itemId: row.itemId,
      referenceType: "sales_order_line",
      referenceId: row.referenceId,
      quantity: -parseFloat(row.quantity),
    })),
  });

  const result = { referenceIds: existingRows.map((row) => row.referenceId) };

  await finishInventoryOperationInTx(tx, {
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey ?? null,
    firstEventId: events[0]?.id ?? null,
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
