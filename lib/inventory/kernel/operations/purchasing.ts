import { and, eq, inArray } from "drizzle-orm";
import {
  type InventoryDisposition,
  inventoryExpectedSummary,
  itemFamilies,
  items,
  purchaseOrderLines,
} from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { trimScaleNullable } from "@/lib/db/numeric";
import { calculateNextCurrentStockUnitCost } from "@/lib/inventory/cost";
import { LotTrackingError, type LotTrackingMode } from "@/lib/inventory/lot-tracking";
import { lockItemsInTx } from "@/lib/inventory/kernel/locking";
import { getDefaultInventoryLocationInTx } from "@/lib/inventory/kernel/locations";
import {
  applyExpectedReferenceDeltasInTx,
  beginInventoryOperationInTx,
  finishInventoryOperationInTx,
  type QuantityReferenceDelta,
} from "@/lib/inventory/kernel/operations/common";
import {
  createPositiveStockEventInTx,
  getCurrentOnHandQtyInTx,
  updateMaterialCurrentStockUnitCostInTx,
} from "@/lib/inventory/kernel/operations/stock-core";

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
    previousPurchaseOrderLineIds?: string[];
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
      previousPurchaseOrderLineIds: params.previousPurchaseOrderLineIds ?? null,
      nextLines: params.nextLines,
    },
  });

  if (replay.replayed) {
    return replay.result;
  }

  const location = await getDefaultInventoryLocationInTx(tx, params.organizationId);
  const existingLineIds =
    params.previousPurchaseOrderLineIds ??
    (
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
    reason: "cancelled" | "deleted" | "received";
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
      disposition?: Extract<InventoryDisposition, "available" | "blocked">;
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
  const itemIds = [...new Set(params.lines.map((line) => line.itemId))];
  const incomingByItemId = new Map<
    string,
    { quantity: number; extendedCost: number }
  >();

  await lockItemsInTx(tx, itemIds);

  const itemCostRows =
    itemIds.length === 0
      ? []
      : await tx
          .select({
            id: items.id,
            currentStockUnitCost: trimScaleNullable(items.currentStockUnitCost).as(
              "currentStockUnitCost"
            ),
            lotTrackingMode: itemFamilies.lotTrackingMode,
          })
          .from(items)
          .innerJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
          .where(inArray(items.id, itemIds));
  const priorStateByItemId = new Map(
    itemCostRows.map((row) => [
      row.id,
      {
        priorQuantity: 0,
        priorUnitCost: row.currentStockUnitCost,
        lotTrackingMode: row.lotTrackingMode as LotTrackingMode,
      },
    ])
  );

  for (const itemId of itemIds) {
    const currentState = priorStateByItemId.get(itemId) ?? {
      priorQuantity: 0,
      priorUnitCost: null,
      lotTrackingMode: "tracked" as LotTrackingMode,
    };
    currentState.priorQuantity = await getCurrentOnHandQtyInTx(tx, itemId);
    priorStateByItemId.set(itemId, currentState);
  }

  for (const [index, line] of params.lines.entries()) {
    if (
      (line.disposition ?? "available") !== "available" &&
      priorStateByItemId.get(line.itemId)?.lotTrackingMode === "untracked"
    ) {
      throw new LotTrackingError("Untracked items can only be received as available.", 409);
    }

    const incoming = incomingByItemId.get(line.itemId) ?? {
      quantity: 0,
      extendedCost: 0,
    };
    incoming.quantity += line.quantity;
    incoming.extendedCost += line.quantity * Number.parseFloat(line.unitCost);
    incomingByItemId.set(line.itemId, incoming);

    const created = await createPositiveStockEventInTx(tx, {
      organizationId: params.organizationId,
      locationId: location.id,
      itemId: line.itemId,
      quantity: line.quantity,
      unitCost: line.unitCost,
      disposition: line.disposition ?? "available",
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

  for (const [itemId, incoming] of incomingByItemId.entries()) {
    const priorState = priorStateByItemId.get(itemId);
    const nextCurrentStockUnitCost = calculateNextCurrentStockUnitCost({
      priorQuantity: priorState?.priorQuantity ?? 0,
      priorUnitCost: priorState?.priorUnitCost ?? null,
      incomingQuantity: incoming.quantity,
      incomingExtendedCost: incoming.extendedCost,
    });

    if (nextCurrentStockUnitCost != null) {
      await updateMaterialCurrentStockUnitCostInTx(tx, {
        itemId,
        currentStockUnitCost: nextCurrentStockUnitCost,
      });
    }
  }

  const result = { eventIds, lotIds };

  await finishInventoryOperationInTx(tx, {
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey ?? null,
    firstEventId: eventIds[0] ?? null,
    result,
  });

  return result;
}
