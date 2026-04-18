import { and, eq, inArray } from "drizzle-orm";
import {
  inventoryExpectedSummary,
  purchaseOrderLines,
} from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { getDefaultInventoryLocationInTx } from "@/lib/inventory/kernel/locations";
import {
  applyExpectedReferenceDeltasInTx,
  beginInventoryOperationInTx,
  finishInventoryOperationInTx,
  type QuantityReferenceDelta,
} from "@/lib/inventory/kernel/operations/common";
import { createPositiveStockEventInTx } from "@/lib/inventory/kernel/operations/stock-core";

export async function addExpectedFromPurchaseInTx(
  tx: Tx,
  params: {
    organizationId: string;
    purchaseOrderId: string;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    lines: Array<{
      purchaseOrderLineId: string;
      itemId: string;
      quantity: number;
    }>;
  }
) {
  const replay = await beginInventoryOperationInTx<{ referenceIds: string[] }>(tx, {
    organizationId: params.organizationId,
    operationName: "addExpectedFromPurchase",
    idempotencyKey: params.idempotencyKey ?? null,
    payload: {
      purchaseOrderId: params.purchaseOrderId,
      lines: params.lines,
    },
  });

  if (replay.replayed) {
    return replay.result;
  }

  const location = await getDefaultInventoryLocationInTx(tx, params.organizationId);
  const events = await applyExpectedReferenceDeltasInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    actorUserId: params.actorUserId ?? null,
    idempotencyKey: params.idempotencyKey ?? null,
    eventSubtype: "purchase_submit",
    deltas: params.lines.map((line) => ({
      itemId: line.itemId,
      referenceType: "purchase_order_line",
      referenceId: line.purchaseOrderLineId,
      quantity: line.quantity,
    })),
  });

  const result = {
    referenceIds: params.lines.map((line) => line.purchaseOrderLineId),
  };

  await finishInventoryOperationInTx(tx, {
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey ?? null,
    firstEventId: events[0]?.id ?? null,
    result,
  });

  return result;
}

export async function editExpectedFromPurchaseInTx(
  tx: Tx,
  params: {
    organizationId: string;
    purchaseOrderId: string;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    nextLines: Array<{
      purchaseOrderLineId: string;
      itemId: string;
      quantity: number;
    }>;
  }
) {
  const replay = await beginInventoryOperationInTx<{ referenceIds: string[] }>(tx, {
    organizationId: params.organizationId,
    operationName: "editExpectedFromPurchase",
    idempotencyKey: params.idempotencyKey ?? null,
    payload: {
      purchaseOrderId: params.purchaseOrderId,
      nextLines: params.nextLines,
    },
  });

  if (replay.replayed) {
    return replay.result;
  }

  const location = await getDefaultInventoryLocationInTx(tx, params.organizationId);
  const existingLineIds = (
    await tx
      .select({ id: purchaseOrderLines.id })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, params.purchaseOrderId))
  ).map((row) => row.id);
  const existingRows =
    existingLineIds.length === 0
      ? []
      : await tx
          .select({
            itemId: inventoryExpectedSummary.itemId,
            referenceId: inventoryExpectedSummary.referenceId,
            quantity: inventoryExpectedSummary.quantity,
          })
          .from(inventoryExpectedSummary)
          .where(
            and(
              eq(inventoryExpectedSummary.organizationId, params.organizationId),
              eq(inventoryExpectedSummary.locationId, location.id),
              eq(inventoryExpectedSummary.referenceType, "purchase_order_line"),
              inArray(inventoryExpectedSummary.referenceId, existingLineIds)
            )
          );

  const existingByRef = new Map(
    existingRows.map((row) => [row.referenceId, { itemId: row.itemId, quantity: parseFloat(row.quantity) }])
  );
  const nextReferenceIds = new Set(
    params.nextLines.map((line) => line.purchaseOrderLineId)
  );
  const deltas: QuantityReferenceDelta[] = [
    ...params.nextLines.map((line) => ({
      itemId: line.itemId,
      referenceType: "purchase_order_line",
      referenceId: line.purchaseOrderLineId,
      quantity:
        line.quantity - (existingByRef.get(line.purchaseOrderLineId)?.quantity ?? 0),
    })),
    ...existingRows
      .filter((row) => !nextReferenceIds.has(row.referenceId))
      .map((row) => ({
        itemId: row.itemId,
        referenceType: "purchase_order_line",
        referenceId: row.referenceId,
        quantity: -parseFloat(row.quantity),
      })),
  ];

  const events = await applyExpectedReferenceDeltasInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    actorUserId: params.actorUserId ?? null,
    idempotencyKey: params.idempotencyKey ?? null,
    eventSubtype: "purchase_edit",
    deltas,
  });

  const result = {
    referenceIds: params.nextLines.map((line) => line.purchaseOrderLineId),
  };

  await finishInventoryOperationInTx(tx, {
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey ?? null,
    firstEventId: events[0]?.id ?? null,
    result,
  });

  return result;
}

export async function releaseExpectedFromPurchaseInTx(
  tx: Tx,
  params: {
    organizationId: string;
    purchaseOrderId: string;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    reason: "cancelled" | "received";
    lineIds?: string[];
  }
) {
  const replay = await beginInventoryOperationInTx<{ referenceIds: string[] }>(tx, {
    organizationId: params.organizationId,
    operationName: "releaseExpectedFromPurchase",
    idempotencyKey: params.idempotencyKey ?? null,
    payload: {
      purchaseOrderId: params.purchaseOrderId,
      reason: params.reason,
      lineIds: params.lineIds ?? null,
    },
  });

  if (replay.replayed) {
    return replay.result;
  }

  const location = await getDefaultInventoryLocationInTx(tx, params.organizationId);
  const targetLineIds =
    params.lineIds ??
    (
      await tx
        .select({ id: purchaseOrderLines.id })
        .from(purchaseOrderLines)
        .where(eq(purchaseOrderLines.purchaseOrderId, params.purchaseOrderId))
    ).map((row) => row.id);

  if (targetLineIds.length === 0) {
    return { referenceIds: [] };
  }

  const existingRows = await tx
    .select({
      itemId: inventoryExpectedSummary.itemId,
      referenceId: inventoryExpectedSummary.referenceId,
      quantity: inventoryExpectedSummary.quantity,
    })
    .from(inventoryExpectedSummary)
    .where(
      and(
        eq(inventoryExpectedSummary.organizationId, params.organizationId),
        eq(inventoryExpectedSummary.locationId, location.id),
        eq(inventoryExpectedSummary.referenceType, "purchase_order_line"),
        inArray(inventoryExpectedSummary.referenceId, targetLineIds)
      )
    );

  const events = await applyExpectedReferenceDeltasInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    actorUserId: params.actorUserId ?? null,
    idempotencyKey: params.idempotencyKey ?? null,
    eventSubtype: params.reason,
    deltas: existingRows.map((row) => ({
      itemId: row.itemId,
      referenceType: "purchase_order_line",
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

export async function receivePurchaseStockInTx(
  tx: Tx,
  params: {
    organizationId: string;
    purchaseOrderId: string;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    lines: Array<{
      purchaseOrderLineId: string;
      itemId: string;
      quantity: number;
      unitCost: string;
      receivedAt?: Date;
    }>;
  }
) {
  const replay = await beginInventoryOperationInTx<{
    eventIds: string[];
    lotIds: string[];
  }>(tx, {
    organizationId: params.organizationId,
    operationName: "receivePurchaseStock",
    idempotencyKey: params.idempotencyKey ?? null,
    payload: {
      purchaseOrderId: params.purchaseOrderId,
      lines: params.lines,
    },
  });

  if (replay.replayed) {
    return replay.result;
  }

  const location = await getDefaultInventoryLocationInTx(tx, params.organizationId);
  const eventIds: string[] = [];
  const lotIds: string[] = [];

  for (const [index, line] of params.lines.entries()) {
    const created = await createPositiveStockEventInTx(tx, {
      organizationId: params.organizationId,
      locationId: location.id,
      itemId: line.itemId,
      quantity: line.quantity,
      unitCost: line.unitCost,
      eventType: "purchase_receipt",
      eventSubtype: "purchase_receive",
      referenceType: "purchase_order",
      referenceId: params.purchaseOrderId,
      actorUserId: params.actorUserId ?? null,
      idempotencyKey: index === 0 ? params.idempotencyKey ?? null : null,
      occurredAt: line.receivedAt,
      receivedAt: line.receivedAt,
      metadata: { purchaseOrderLineId: line.purchaseOrderLineId },
    });
    eventIds.push(created.eventId);
    lotIds.push(created.lotId);
  }

  await applyExpectedReferenceDeltasInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    actorUserId: params.actorUserId ?? null,
    eventSubtype: "purchase_receive",
    deltas: params.lines.map((line) => ({
      itemId: line.itemId,
      referenceType: "purchase_order_line",
      referenceId: line.purchaseOrderLineId,
      quantity: -line.quantity,
    })),
  });

  const result = { eventIds, lotIds };

  await finishInventoryOperationInTx(tx, {
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey ?? null,
    firstEventId: eventIds[0] ?? null,
    result,
  });

  return result;
}
