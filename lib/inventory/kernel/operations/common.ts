import { and, eq, inArray } from "drizzle-orm";
import { normalizeNumeric, roundQuantity } from "@/lib/format";
import type { Tx } from "@/lib/db/with-org-context";
import {
  inventoryDemandSummary,
} from "@/lib/db/schema";
import {
  applyDemandSummaryDeltasInTx,
  applyExpectedSummaryDeltasInTx,
  applyItemBalanceDeltasInTx,
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

export async function runIdempotentInventoryOperationInTx<TResult>(
  tx: Tx,
  params: {
    organizationId: string;
    operationName: string;
    idempotencyKey?: string | null;
    payload: Record<string, unknown>;
  },
  run: () => Promise<TResult>
): Promise<{ result: TResult; replayed: boolean }> {
  const replay = await beginInventoryOperationInTx<TResult>(tx, params);

  if (replay.replayed) {
    return { result: replay.result, replayed: true };
  }

  const result = await run();
  await finishInventoryOperationInTx(tx, {
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey ?? null,
    result,
  });

  return { result, replayed: false };
}

function summarizeItemDeltas(
  deltas: QuantityReferenceDelta[],
  direction: "demand" | "expected"
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

    if (direction === "demand") {
      itemDelta.demandDelta = quantity;
    } else {
      itemDelta.expectedDelta = quantity;
    }

    return itemDelta;
  });
}

function referenceKey(delta: {
  itemId: string;
  referenceType: string;
  referenceId: string;
}) {
  return [delta.itemId, delta.referenceType, delta.referenceId].join(":");
}

async function clampDemandDeltasInTx(
  tx: Tx,
  params: {
    organizationId: string;
    locationId: string;
    deltas: QuantityReferenceDelta[];
  }
) {
  const itemIds = [...new Set(params.deltas.map((delta) => delta.itemId))];
  const existingRows = itemIds.length
    ? await tx
        .select({
          itemId: inventoryDemandSummary.itemId,
          referenceType: inventoryDemandSummary.referenceType,
          referenceId: inventoryDemandSummary.referenceId,
          quantity: inventoryDemandSummary.quantity,
        })
        .from(inventoryDemandSummary)
        .where(
          and(
            eq(inventoryDemandSummary.organizationId, params.organizationId),
            eq(inventoryDemandSummary.locationId, params.locationId),
            inArray(inventoryDemandSummary.itemId, itemIds)
          )
        )
    : [];

  const currentByReference = new Map(
    existingRows.map((row) => [referenceKey(row), parseFloat(row.quantity)])
  );
  const adjusted: QuantityReferenceDelta[] = [];

  for (const delta of params.deltas) {
    const key = referenceKey(delta);

    if (delta.quantity > 0) {
      adjusted.push(delta);
      currentByReference.set(
        key,
        roundQuantity((currentByReference.get(key) ?? 0) + delta.quantity)
      );
      continue;
    }

    const current = Math.max(0, currentByReference.get(key) ?? 0);
    const quantity = roundQuantity(Math.min(Math.abs(delta.quantity), current));

    if (quantity > 0) {
      adjusted.push({ ...delta, quantity: -quantity });
      currentByReference.set(key, roundQuantity(current - quantity));
    }
  }

  return adjusted;
}

export async function applyDemandReferenceDeltasInTx(
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

  const adjusted = await clampDemandDeltasInTx(tx, {
    organizationId: params.organizationId,
    locationId: params.locationId,
    deltas: filtered,
  });

  if (adjusted.length === 0) {
    return [];
  }

  const inserted = await insertInventoryEventsInTx(
    tx,
    adjusted.map((delta, index) => ({
      organizationId: params.organizationId,
      locationId: params.locationId,
      eventType:
        delta.quantity > 0 ? ("demand_increase" as InventoryEventType) : "demand_release",
      eventSubtype: params.eventSubtype ?? null,
      itemId: delta.itemId,
      quantity: normalizeNumeric(Math.abs(delta.quantity)),
      referenceType: delta.referenceType,
      referenceId: delta.referenceId,
      actorUserId: params.actorUserId ?? null,
      idempotencyKey: index === 0 ? params.idempotencyKey ?? null : null,
    }))
  );

  await applyDemandSummaryDeltasInTx(
    tx,
    adjusted.map((delta) => ({
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
    summarizeItemDeltas(adjusted, "demand").map((delta) => ({
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
