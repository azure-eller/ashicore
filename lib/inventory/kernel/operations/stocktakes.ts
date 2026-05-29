import { roundQuantity } from "@/lib/format";
import { inventoryEvents } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { getDefaultInventoryLocationInTx } from "@/lib/inventory/kernel/locations";
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
    reason?: string | null;
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
  const replay = await beginInventoryOperationInTx<{ eventIds: string[] }>(tx, {
    organizationId: params.organizationId,
    operationName: "reconcileStocktakeCount",
    idempotencyKey: params.idempotencyKey ?? null,
    payload: {
      stocktakeId: params.stocktakeId,
      lines: params.lines,
    },
  });

  if (replay.replayed) {
    return replay.result;
  }

  const location = await getDefaultInventoryLocationInTx(tx, params.organizationId);
  const eventIds: string[] = [];
  const now = new Date();
  const reason = params.reason?.trim() || null;
  const metadata = reason
    ? { stocktakeId: params.stocktakeId, reason }
    : { stocktakeId: params.stocktakeId };

  for (const [index, line] of params.lines.entries()) {
    const variance = roundQuantity(line.variance);

    if (variance > 0) {
      const unitCost = await resolvePositiveStockUnitCostInTx(tx, {
        itemId: line.itemId,
        reason: "stocktake_cost_policy",
      });
      const eventParams = {
        organizationId: params.organizationId,
        locationId: location.id,
        itemId: line.itemId,
        quantity: variance,
        unitCost,
        eventType: "stocktake_gain" as const,
        eventSubtype: "stocktake_complete",
        referenceType: "stocktake_line",
        referenceId: line.stocktakeLineId,
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
    } else if (variance < 0) {
      const eventParams = {
        organizationId: params.organizationId,
        locationId: location.id,
        itemId: line.itemId,
        quantity: Math.abs(variance),
        eventType: "stocktake_loss" as const,
        eventSubtype: "stocktake_complete",
        referenceType: "stocktake_line",
        referenceId: line.stocktakeLineId,
        actorUserId: params.actorUserId ?? null,
        idempotencyKey: index === 0 ? params.idempotencyKey ?? null : null,
        occurredAt: line.countedAt,
        metadata,
      };
      if (line.lotId) {
        const consumed = await decrementExistingLotStockInTx(tx, {
          ...eventParams,
          lotId: line.lotId,
        });
        eventIds.push(consumed.eventId);
      } else {
        const consumed = await consumeStockFifoInTx(tx, eventParams);
        eventIds.push(...consumed.eventIds);
      }
    } else {
      const [event] = await tx
        .insert(inventoryEvents)
        .values({
          organizationId: params.organizationId,
          locationId: location.id,
          eventType: "stocktake_verification",
          itemId: line.itemId,
          quantity: "0",
          referenceType: "stocktake_line",
          referenceId: line.stocktakeLineId,
          actorUserId: params.actorUserId ?? null,
          idempotencyKey: index === 0 ? params.idempotencyKey ?? null : null,
          occurredAt: line.countedAt ?? now,
          metadata,
        })
        .returning({ id: inventoryEvents.id });
      eventIds.push(event.id);
    }

    await applyItemBalanceDeltasInTx(tx, [
      {
        organizationId: params.organizationId,
        locationId: location.id,
        itemId: line.itemId,
        lastVerifiedAt: line.countedAt ?? now,
      },
    ]);
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
