import { normalizeNumeric, roundQuantity } from "@/lib/format";
import type { Tx } from "@/lib/db/with-org-context";
import {
  applyExpectedSummaryDeltasInTx,
  applyItemBalanceDeltasInTx,
  applyReservationSummaryDeltasInTx,
  type ItemBalanceDelta,
} from "@/lib/inventory/kernel/projections";
import {
  claimInventoryIdempotencyInTx,
  completeInventoryIdempotencyClaimInTx,
} from "@/lib/inventory/kernel/idempotency";
import { insertInventoryEventsInTx } from "@/lib/inventory/kernel/events";
import { lockItemsInTx } from "@/lib/inventory/kernel/locking";
import type { InventoryEventType } from "@/lib/db/schema";

export type QuantityReferenceDelta = {
  itemId: string;
  referenceType: string;
  referenceId: string;
  quantity: number;
};

export async function beginInventoryOperationInTx<TResult>(
  tx: Tx,
  params: {
    organizationId: string;
    operationName: string;
    idempotencyKey?: string | null;
    payload: Record<string, unknown>;
  }
): Promise<
  | {
      replayed: true;
      result: TResult;
    }
  | {
      replayed: false;
    }
> {
  if (!params.idempotencyKey) {
    return { replayed: false };
  }

  const claim = await claimInventoryIdempotencyInTx(tx, {
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey,
    operationName: params.operationName,
    payload: params.payload,
  });

  if (!claim.claimed) {
    return {
      replayed: true,
      result: claim.claim.resultEnvelope as TResult,
    };
  }

  return { replayed: false };
}

export async function finishInventoryOperationInTx<TResult>(
  tx: Tx,
  params: {
    organizationId: string;
    idempotencyKey?: string | null;
    firstEventId?: string | null;
    result: TResult;
  }
) {
  if (!params.idempotencyKey) {
    return;
  }

  await completeInventoryIdempotencyClaimInTx(tx, {
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey,
    firstEventId: params.firstEventId ?? null,
    resultEnvelope: params.result,
  });
}

function summarizeItemDeltas(
  deltas: QuantityReferenceDelta[],
  direction: "committed" | "expected"
) {
  const summarized = new Map<string, number>();

  for (const delta of deltas) {
    summarized.set(
      delta.itemId,
      roundQuantity((summarized.get(delta.itemId) ?? 0) + delta.quantity)
    );
  }

  return [...summarized.entries()].map(([itemId, quantity]) => {
    const itemDelta: ItemBalanceDelta = {
      organizationId: "",
      locationId: "",
      itemId,
    };

    if (direction === "committed") {
      itemDelta.committedDelta = quantity;
    } else {
      itemDelta.expectedDelta = quantity;
    }

    return itemDelta;
  });
}

export async function applyReservationReferenceDeltasInTx(
  tx: Tx,
  params: {
    organizationId: string;
    locationId: string;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    deltas: QuantityReferenceDelta[];
    eventSubtype?: string | null;
  }
) {
  const filtered = params.deltas
    .map((delta) => ({
      ...delta,
      quantity: roundQuantity(delta.quantity),
    }))
    .filter((delta) => delta.quantity !== 0);

  if (filtered.length === 0) {
    return [];
  }

  await lockItemsInTx(
    tx,
    filtered.map((delta) => delta.itemId)
  );

  const inserted = await insertInventoryEventsInTx(
    tx,
    filtered.map((delta, index) => ({
      organizationId: params.organizationId,
      locationId: params.locationId,
      eventType:
        delta.quantity > 0 ? ("reservation_increase" as InventoryEventType) : "reservation_release",
      eventSubtype: params.eventSubtype ?? null,
      itemId: delta.itemId,
      quantity: normalizeNumeric(Math.abs(delta.quantity)),
      referenceType: delta.referenceType,
      referenceId: delta.referenceId,
      actorUserId: params.actorUserId ?? null,
      idempotencyKey: index === 0 ? params.idempotencyKey ?? null : null,
    }))
  );

  await applyReservationSummaryDeltasInTx(
    tx,
    filtered.map((delta) => ({
      organizationId: params.organizationId,
      locationId: params.locationId,
      itemId: delta.itemId,
      referenceType: delta.referenceType,
      referenceId: delta.referenceId,
      quantity: delta.quantity,
    }))
  );

  await applyItemBalanceDeltasInTx(
    tx,
    summarizeItemDeltas(filtered, "committed").map((delta) => ({
      ...delta,
      organizationId: params.organizationId,
      locationId: params.locationId,
    }))
  );

  return inserted;
}

export async function applyExpectedReferenceDeltasInTx(
  tx: Tx,
  params: {
    organizationId: string;
    locationId: string;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    deltas: QuantityReferenceDelta[];
    eventSubtype?: string | null;
  }
) {
  const filtered = params.deltas
    .map((delta) => ({
      ...delta,
      quantity: roundQuantity(delta.quantity),
    }))
    .filter((delta) => delta.quantity !== 0);

  if (filtered.length === 0) {
    return [];
  }

  await lockItemsInTx(
    tx,
    filtered.map((delta) => delta.itemId)
  );

  const inserted = await insertInventoryEventsInTx(
    tx,
    filtered.map((delta, index) => ({
      organizationId: params.organizationId,
      locationId: params.locationId,
      eventType:
        delta.quantity > 0 ? ("expected_increase" as InventoryEventType) : "expected_release",
      eventSubtype: params.eventSubtype ?? null,
      itemId: delta.itemId,
      quantity: normalizeNumeric(Math.abs(delta.quantity)),
      referenceType: delta.referenceType,
      referenceId: delta.referenceId,
      actorUserId: params.actorUserId ?? null,
      idempotencyKey: index === 0 ? params.idempotencyKey ?? null : null,
    }))
  );

  await applyExpectedSummaryDeltasInTx(
    tx,
    filtered.map((delta) => ({
      organizationId: params.organizationId,
      locationId: params.locationId,
      itemId: delta.itemId,
      referenceType: delta.referenceType,
      referenceId: delta.referenceId,
      quantity: delta.quantity,
    }))
  );

  await applyItemBalanceDeltasInTx(
    tx,
    summarizeItemDeltas(filtered, "expected").map((delta) => ({
      ...delta,
      organizationId: params.organizationId,
      locationId: params.locationId,
    }))
  );

  return inserted;
}
