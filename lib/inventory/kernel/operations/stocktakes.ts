import { and, eq } from "drizzle-orm";
import { roundQuantity } from "@/lib/format";
import {
  type AdjustmentReason,
  inventoryEventAdjustmentReasons,
  inventoryEvents,
  inventoryLotBalances,
} from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { resolveInventoryLocationInTx } from "@/lib/inventory/kernel/locations";
import {
  beginInventoryOperationInTx,
  finishInventoryOperationInTx,
} from "@/lib/inventory/kernel/operations/common";
import {
  appendPositiveStockToExistingLotInTx,
  consumeStockFifoInTx,
  createPositiveStockEventInTx,
  decrementExistingLotStockInTx,
  resolvePositiveStockUnitCostInTx,
} from "@/lib/inventory/kernel/operations/stock-core";
import { applyItemBalanceDeltasInTx } from "@/lib/inventory/kernel/projections";

export async function reconcileStocktakeCountInTx(
  tx: Tx,
  params: {
    organizationId: string;
    stocktakeId: string;
    // Count location; omitted = default (legacy stocktakes have none).
    locationId?: string | null;
    reason: AdjustmentReason;
    note?: string | null;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    lines: Array<{
      stocktakeLineId: string;
      itemId: string;
      lotId?: string | null;
      foundLotNumber?: string | null;
      variance: number;
      countedAt?: Date;
      costPolicy?: "default";
    }>;
  }
) {
  return reconcilePhysicalInventoryCountInTx(tx, {
    ...params,
    idempotencyOperationName: "reconcileStocktakeCount",
    idempotencyPayload: {
      stocktakeId: params.stocktakeId,
      locationId: params.locationId ?? null,
      lines: params.lines,
    },
    source: {
      kind: "stocktake",
      stocktakeId: params.stocktakeId,
    },
    lines: params.lines.map((line) => ({
      ...line,
      referenceId: line.stocktakeLineId,
    })),
  });
}

export async function reconcilePhysicalInventoryCountInTx(
  tx: Tx,
  params: {
    organizationId: string;
    // Count location; omitted = default. Stocktakes pass their stamped
    // location; manual adjustments pass the operator's choice.
    locationId?: string | null;
    source:
      | { kind: "stocktake"; stocktakeId: string }
      | { kind: "manual_adjustment" };
    reason: AdjustmentReason;
    note?: string | null;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    idempotencyOperationName?: string;
    idempotencyPayload?: Record<string, unknown>;
    lines: Array<{
      referenceId: string;
      itemId: string;
      lotId?: string | null;
      foundLotNumber?: string | null;
      variance: number;
      countedAt?: Date;
      costPolicy?: "default";
    }>;
  }
) {
  const replay = await beginInventoryOperationInTx<{ eventIds: string[] }>(tx, {
    organizationId: params.organizationId,
    operationName:
      params.idempotencyOperationName ?? "reconcilePhysicalInventoryCount",
    idempotencyKey: params.idempotencyKey ?? null,
    payload:
      params.idempotencyPayload ?? {
        source: params.source,
        locationId: params.locationId ?? null,
        reason: params.reason,
        note: params.note ?? null,
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
  const now = new Date();
  const metadata =
    params.source.kind === "stocktake"
      ? { stocktakeId: params.source.stocktakeId }
      : null;
  const eventConfig =
    params.source.kind === "stocktake"
      ? {
          gain: "stocktake_gain" as const,
          loss: "stocktake_loss" as const,
          zero: "stocktake_verification" as const,
          subtype: "stocktake_complete",
          referenceType: "stocktake_line",
        }
      : {
          gain: "manual_adjustment_increase" as const,
          loss: "manual_adjustment_decrease" as const,
          zero: null,
          subtype: "manual_adjustment",
          referenceType: "item",
        };

  const recordReason = async (ids: string[]) => {
    if (ids.length === 0) return;
    await tx.insert(inventoryEventAdjustmentReasons).values(
      ids.map((eventId) => ({
        inventoryEventId: eventId,
        organizationId: params.organizationId,
        reason: params.reason,
        note: params.note?.trim() || null,
      }))
    );
  };

  for (const [index, line] of params.lines.entries()) {
    const variance = roundQuantity(line.variance);

    if (variance > 0) {
      const unitCost = line.lotId
        ? await resolveExistingLotGainUnitCostInTx(tx, {
            organizationId: params.organizationId,
            locationId: location.id,
            itemId: line.itemId,
            lotId: line.lotId,
          })
        : await resolvePositiveStockUnitCostInTx(tx, {
            itemId: line.itemId,
            reason: "stocktake_cost_policy",
          });
      const eventParams = {
        organizationId: params.organizationId,
        locationId: location.id,
        itemId: line.itemId,
        quantity: variance,
        unitCost,
        eventType: eventConfig.gain,
        eventSubtype: eventConfig.subtype,
        referenceType: eventConfig.referenceType,
        referenceId: line.referenceId,
        actorUserId: params.actorUserId ?? null,
        idempotencyKey: index === 0 ? params.idempotencyKey ?? null : null,
        occurredAt: line.countedAt,
        metadata,
      };
      const created = line.lotId
        ? await appendPositiveStockToExistingLotInTx(tx, {
            ...eventParams,
            lotId: line.lotId,
          })
        : await createPositiveStockEventInTx(tx, {
            ...eventParams,
            // Found lots have no lotId yet; the kernel creates (or upserts) the
            // lot from this operator-supplied number and posts the gain to it
            // atomically and audited. When no number is given (untracked /
            // adjustment), the kernel generates one.
            lotNumber: line.foundLotNumber ?? null,
          });
      eventIds.push(created.eventId);
      await recordReason([created.eventId]);
    } else if (variance < 0) {
      const eventParams = {
        organizationId: params.organizationId,
        locationId: location.id,
        itemId: line.itemId,
        quantity: Math.abs(variance),
        eventType: eventConfig.loss,
        eventSubtype: eventConfig.subtype,
        referenceType: eventConfig.referenceType,
        referenceId: line.referenceId,
        actorUserId: params.actorUserId ?? null,
        idempotencyKey: index === 0 ? params.idempotencyKey ?? null : null,
        occurredAt: line.countedAt,
        metadata,
        allowNegativeStock: params.source.kind === "manual_adjustment",
      };
      if (line.lotId) {
        const consumed = await decrementExistingLotStockInTx(tx, {
          ...eventParams,
          lotId: line.lotId,
        });
        eventIds.push(consumed.eventId);
        await recordReason([consumed.eventId]);
      } else {
        const consumed = await consumeStockFifoInTx(tx, eventParams);
        eventIds.push(...consumed.eventIds);
        await recordReason(consumed.eventIds);
      }
    } else if (eventConfig.zero) {
      const [event] = await tx
        .insert(inventoryEvents)
        .values({
          organizationId: params.organizationId,
          locationId: location.id,
          eventType: eventConfig.zero,
          itemId: line.itemId,
          quantity: "0",
          referenceType: eventConfig.referenceType,
          referenceId: line.referenceId,
          actorUserId: params.actorUserId ?? null,
          idempotencyKey: index === 0 ? params.idempotencyKey ?? null : null,
          occurredAt: line.countedAt ?? now,
          metadata,
        })
        .returning({ id: inventoryEvents.id });
      eventIds.push(event.id);
      await recordReason([event.id]);
    }

    if (params.source.kind === "stocktake") {
      await applyItemBalanceDeltasInTx(tx, [
        {
          organizationId: params.organizationId,
          locationId: location.id,
          itemId: line.itemId,
          lastVerifiedAt: line.countedAt ?? now,
        },
      ]);
    }
  }

  const result = { eventIds };

  await finishInventoryOperationInTx(tx, {
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey ?? null,
    firstEventId: eventIds[0] ?? null,
    result,
  });

  return result;
}

async function resolveExistingLotGainUnitCostInTx(
  tx: Tx,
  params: {
    organizationId: string;
    locationId: string;
    itemId: string;
    lotId: string;
  }
) {
  const [currentBalance] = await tx
    .select({ unitCost: inventoryLotBalances.unitCost })
    .from(inventoryLotBalances)
    .where(
      and(
        eq(inventoryLotBalances.organizationId, params.organizationId),
        eq(inventoryLotBalances.locationId, params.locationId),
        eq(inventoryLotBalances.itemId, params.itemId),
        eq(inventoryLotBalances.lotId, params.lotId),
        eq(inventoryLotBalances.disposition, "available")
      )
    )
    .for("update");

  return currentBalance?.unitCost
    ?? await resolvePositiveStockUnitCostInTx(tx, {
      itemId: params.itemId,
      reason: "stocktake_cost_policy",
    });
}
