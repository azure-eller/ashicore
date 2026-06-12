import { and, eq, inArray } from "drizzle-orm";
import {
  type InventoryDisposition,
  inventoryExpectedSummary,
  inventoryEvents,
  inventoryLotBalances,
  itemFamilies,
  items,
  purchaseOrderLines,
} from "@/lib/db/schema";
import { normalizeNumeric, normalizeNumericScale, roundQuantity } from "@/lib/format";
import type { Tx } from "@/lib/db/with-org-context";
import { trimScaleNullable } from "@/lib/db/numeric";
import { calculateNextCurrentStockUnitCost } from "@/lib/inventory/cost";
import { LotTrackingError, type LotTrackingMode } from "@/lib/inventory/lot-tracking";
import { insertInventoryEventsInTx } from "@/lib/inventory/kernel/events";
import {
  lockItemsInTx,
  lockSourceDocumentInTx,
} from "@/lib/inventory/kernel/locking";
import {
  getDefaultInventoryLocationInTx,
  resolveInventoryLocationInTx,
} from "@/lib/inventory/kernel/locations";
import {
  applyExpectedReferenceDeltasInTx,
  beginInventoryOperationInTx,
  finishInventoryOperationInTx,
  type QuantityReferenceDelta,
} from "@/lib/inventory/kernel/operations/common";
import type { InventoryEventInput } from "@/lib/inventory/kernel/types";
import {
  calculateExtendedCostDelta,
  createPositiveStockEventInTx,
  DEFAULT_DISPOSITION,
  getCurrentOnHandQtyInTx,
  recomputeMaterialCurrentStockUnitCostFromLotsInTx,
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
    // Physical receipt location; omitted = default. Expected-supply release
    // stays at the default location (planning is default-pinned in v1).
    locationId?: string | null;
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
      locationId: params.locationId ?? null,
      lines: params.lines,
    },
  });

  if (replay.replayed) {
    return replay.result;
  }

  const location = await resolveInventoryLocationInTx(
    tx,
    params.organizationId,
    params.locationId
  );
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

  // Planning is default-pinned in v1: expected/demand balances were recorded
  // at the default location and must be released there, regardless of where
  // the physical leg happened.
  const planningLocation = await getDefaultInventoryLocationInTx(
    tx,
    params.organizationId
  );
  await applyExpectedReferenceDeltasInTx(tx, {
    organizationId: params.organizationId,
    locationId: planningLocation.id,
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

export async function revaluePurchaseLandedCostInTx(
  tx: Tx,
  params: {
    organizationId: string;
    purchaseOrderId: string;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    lines: Array<{
      purchaseOrderLineId: string;
      itemId: string;
      unitCost: string;
    }>;
  }
) {
  const replay = await beginInventoryOperationInTx<{
    eventIds: string[];
    lotIds: string[];
  }>(tx, {
    organizationId: params.organizationId,
    operationName: "revaluePurchaseLandedCost",
    idempotencyKey: params.idempotencyKey ?? null,
    payload: {
      purchaseOrderId: params.purchaseOrderId,
      lines: params.lines,
    },
  });

  if (replay.replayed) {
    return replay.result;
  }

  const targetLines = params.lines.filter((line) => line.unitCost.trim() !== "");
  if (targetLines.length === 0) {
    const result = { eventIds: [], lotIds: [] };
    await finishInventoryOperationInTx(tx, {
      organizationId: params.organizationId,
      idempotencyKey: params.idempotencyKey ?? null,
      result,
    });
    return result;
  }

  // The PO edit path collapses to one line per item, so itemId + PO is the
  // effective receipt key here — avoids a non-indexable metadata->>'...' join
  // and still matches receipts that predate the line-id metadata.
  const targetLineByItemId = new Map(targetLines.map((line) => [line.itemId, line]));
  const itemIds = [...new Set(targetLines.map((line) => line.itemId))];

  await lockSourceDocumentInTx(
    tx,
    "revaluePurchaseLandedCost",
    params.purchaseOrderId
  );
  await lockItemsInTx(tx, itemIds);

  const itemModeRows = await tx
    .select({
      id: items.id,
      lotTrackingMode: itemFamilies.lotTrackingMode,
    })
    .from(items)
    .innerJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
    .where(inArray(items.id, itemIds));

  const revaluableItemIds = itemModeRows.flatMap((row) => {
    if ((row.lotTrackingMode as LotTrackingMode) === "tracked") {
      return [row.id];
    }

    // TODO(#615): extend revaluation to untracked MAC-bucket materials. v1
    // saves the PO edit but skips those shared-bucket cost adjustments.
    return [];
  });

  if (revaluableItemIds.length === 0) {
    const result = { eventIds: [], lotIds: [] };
    await finishInventoryOperationInTx(tx, {
      organizationId: params.organizationId,
      idempotencyKey: params.idempotencyKey ?? null,
      result,
    });
    return result;
  }

  const lineByItemId = new Map(
    revaluableItemIds.flatMap((itemId) => {
      const line = targetLineByItemId.get(itemId);
      return line ? [[itemId, line] as const] : [];
    })
  );

  const receiptRows = await tx
    .select({
      itemId: inventoryEvents.itemId,
      lotId: inventoryEvents.lotId,
      quantity: inventoryEvents.quantity,
    })
    .from(inventoryEvents)
    .where(
      and(
        eq(inventoryEvents.organizationId, params.organizationId),
        eq(inventoryEvents.eventType, "purchase_receipt"),
        eq(inventoryEvents.referenceType, "purchase_order"),
        eq(inventoryEvents.referenceId, params.purchaseOrderId),
        inArray(inventoryEvents.itemId, revaluableItemIds)
      )
    );

  const receiptRowsWithLots = receiptRows.flatMap((row) =>
    row.lotId == null ? [] : [{ ...row, lotId: row.lotId }]
  );

  if (receiptRowsWithLots.length === 0) {
    const result = { eventIds: [], lotIds: [] };
    await finishInventoryOperationInTx(tx, {
      organizationId: params.organizationId,
      idempotencyKey: params.idempotencyKey ?? null,
      result,
    });
    return result;
  }

  const lotIds = [...new Set(receiptRowsWithLots.map((row) => row.lotId))];
  const balanceRows = await tx
    .select({
      locationId: inventoryLotBalances.locationId,
      itemId: inventoryLotBalances.itemId,
      lotId: inventoryLotBalances.lotId,
      quantity: inventoryLotBalances.quantity,
      unitCost: inventoryLotBalances.unitCost,
    })
    .from(inventoryLotBalances)
    .where(
      and(
        eq(inventoryLotBalances.organizationId, params.organizationId),
        inArray(inventoryLotBalances.lotId, lotIds),
        eq(inventoryLotBalances.disposition, DEFAULT_DISPOSITION)
      )
    )
    .for("update");

  // A lot can span several locations. Track the available quantity for the
  // on-hand guard plus per-location quantity, so the revaluation fans out one
  // event per location the lot actually occupies.
  const lotInfo = new Map<
    string,
    {
      itemId: string;
      unitCost: string | null;
      availableQuantity: number;
      quantityByLocation: Map<string, number>;
    }
  >();

  for (const row of balanceRows) {
    const info = lotInfo.get(row.lotId) ?? {
      itemId: row.itemId,
      unitCost: row.unitCost,
      availableQuantity: 0,
      quantityByLocation: new Map<string, number>(),
    };
    info.unitCost = info.unitCost ?? row.unitCost;
    info.availableQuantity = roundQuantity(
      info.availableQuantity + parseFloat(row.quantity)
    );
    info.quantityByLocation.set(
      row.locationId,
      roundQuantity(
        (info.quantityByLocation.get(row.locationId) ?? 0) + parseFloat(row.quantity)
      )
    );
    lotInfo.set(row.lotId, info);
  }

  const eventInputs: InventoryEventInput[] = [];
  const changedLotIds: string[] = [];
  for (const lotId of lotIds) {
    const info = lotInfo.get(lotId);
    if (!info || info.unitCost == null) {
      continue;
    }
    const line = lineByItemId.get(info.itemId);
    if (!line) {
      continue;
    }

    const previousUnitCost = normalizeNumericScale(parseFloat(info.unitCost), 6);
    const newUnitCost = normalizeNumericScale(parseFloat(line.unitCost), 6);
    if (previousUnitCost === newUnitCost) {
      continue;
    }

    // One revaluation event per location the lot occupies, so the signed value
    // delta lands on the right location instead of an arbitrary first row.
    const eventCountBefore = eventInputs.length;
    for (const [locationId, locationQuantity] of info.quantityByLocation) {
      if (locationQuantity <= 0) {
        continue;
      }
      const revaluedQuantity = normalizeNumeric(locationQuantity);
      const extendedCost = calculateExtendedCostDelta(
        revaluedQuantity,
        previousUnitCost,
        newUnitCost
      );

      eventInputs.push({
        organizationId: params.organizationId,
        locationId,
        eventType: "landed_cost_revaluation" as const,
        eventSubtype: "purchase_landed_cost_edit",
        itemId: info.itemId,
        lotId,
        quantity: "0",
        unitCost: newUnitCost,
        extendedCost,
        referenceType: "purchase_order",
        referenceId: params.purchaseOrderId,
        actorUserId: params.actorUserId ?? null,
        idempotencyKey:
          eventInputs.length === 0 ? params.idempotencyKey ?? null : null,
        metadata: {
          purchaseOrderLineId: line.purchaseOrderLineId,
          previousUnitCost,
          newUnitCost,
          revaluedQuantity,
          allocationBasis: "by_value",
          costingMode: "fifo_lot",
        },
      });
    }
    // Only rewrite the lot's cost when we actually emitted a revaluation event
    // for it, so the lot UPDATE, the ledger events, and the item-cost recompute
    // (driven by changedItemIds) stay in lockstep.
    if (eventInputs.length === eventCountBefore) {
      continue;
    }
    changedLotIds.push(lotId);

    await tx
      .update(inventoryLotBalances)
      .set({
        unitCost: newUnitCost,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(inventoryLotBalances.organizationId, params.organizationId),
          eq(inventoryLotBalances.itemId, info.itemId),
          eq(inventoryLotBalances.lotId, lotId),
          eq(inventoryLotBalances.disposition, DEFAULT_DISPOSITION)
        )
      );
  }

  const events = await insertInventoryEventsInTx(tx, eventInputs);

  const changedItemIds = [...new Set(eventInputs.map((event) => event.itemId))];
  for (const itemId of changedItemIds) {
    await recomputeMaterialCurrentStockUnitCostFromLotsInTx(tx, {
      organizationId: params.organizationId,
      itemId,
    });
  }

  const result = {
    eventIds: events.map((event) => event.id),
    lotIds: [...new Set(changedLotIds)],
  };

  await finishInventoryOperationInTx(tx, {
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey ?? null,
    firstEventId: events[0]?.id ?? null,
    result,
  });

  return result;
}
