import { and, eq, sql } from "drizzle-orm";
import { normalizeNumeric, roundQuantity } from "@/lib/format";
import {
  type InventoryDisposition,
  inventoryExpectedSummary,
  inventoryItemBalances,
  inventoryLotBalances,
  inventoryDemandSummary,
  inventoryReservationsSummary,
} from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";

export type ItemBalanceDelta = {
  organizationId: string;
  locationId: string;
  itemId: string;
  onHandDelta?: number;
  committedDelta?: number;
  demandDelta?: number;
  expectedDelta?: number;
  lastVerifiedAt?: Date | null;
};

export type LotBalanceDelta = {
  organizationId: string;
  locationId: string;
  lotId: string;
  itemId: string;
  disposition?: InventoryDisposition;
  quantityDelta: number;
  unitCost?: string | null;
  receivedAt?: Date;
  originEventId?: string;
};

type SummaryDelta = {
  organizationId: string;
  locationId: string;
  itemId: string;
  referenceType: string;
  referenceId: string;
  quantity: number;
};

type AggregatedItemBalanceDelta = ItemBalanceDelta & {
  onHandDelta: number;
  committedDelta: number;
  demandDelta: number;
  expectedDelta: number;
};

type AggregatedLotBalanceDelta = {
  organizationId: string;
  locationId: string;
  lotId: string;
  itemId: string;
  disposition: InventoryDisposition;
  quantityDelta: number;
  unitCost?: string | null;
  receivedAt?: Date;
  originEventId?: string;
};

type ItemBalanceKey = {
  organizationId: string;
  locationId: string;
  itemId: string;
};

function itemBalanceKey(delta: {
  organizationId: string;
  locationId: string;
  itemId: string;
}) {
  return `${delta.organizationId}:${delta.locationId}:${delta.itemId}`;
}

function summaryKey(delta: SummaryDelta) {
  return [
    delta.organizationId,
    delta.locationId,
    delta.itemId,
    delta.referenceType,
    delta.referenceId,
  ].join(":");
}

function aggregateItemBalanceDeltas(deltas: ItemBalanceDelta[]) {
  const aggregated = new Map<string, AggregatedItemBalanceDelta>();

  for (const delta of deltas) {
    const key = itemBalanceKey(delta);
    const current = aggregated.get(key) ?? {
      organizationId: delta.organizationId,
      locationId: delta.locationId,
      itemId: delta.itemId,
      onHandDelta: 0,
      committedDelta: 0,
      demandDelta: 0,
      expectedDelta: 0,
      lastVerifiedAt: undefined,
    };

    current.onHandDelta = roundQuantity(
      current.onHandDelta + (delta.onHandDelta ?? 0)
    );
    current.committedDelta = roundQuantity(
      current.committedDelta + (delta.committedDelta ?? 0)
    );
    current.demandDelta = roundQuantity(
      current.demandDelta + (delta.demandDelta ?? 0)
    );
    current.expectedDelta = roundQuantity(
      current.expectedDelta + (delta.expectedDelta ?? 0)
    );

    if (delta.lastVerifiedAt !== undefined) {
      current.lastVerifiedAt = delta.lastVerifiedAt;
    }

    aggregated.set(key, current);
  }

  return [...aggregated.values()];
}

function aggregateLotBalanceDeltas(deltas: LotBalanceDelta[]) {
  const aggregated = new Map<string, AggregatedLotBalanceDelta>();

  for (const delta of deltas) {
    const disposition = delta.disposition ?? "available";
    const key = [
      delta.organizationId,
      delta.itemId,
      delta.locationId,
      delta.lotId,
      disposition,
    ].join(":");
    const current = aggregated.get(key) ?? {
      organizationId: delta.organizationId,
      locationId: delta.locationId,
      lotId: delta.lotId,
      itemId: delta.itemId,
      disposition,
      quantityDelta: 0,
      unitCost: delta.unitCost,
      receivedAt: delta.receivedAt,
      originEventId: delta.originEventId,
    };

    current.quantityDelta = roundQuantity(current.quantityDelta + delta.quantityDelta);
    current.unitCost = delta.unitCost ?? current.unitCost ?? null;
    current.receivedAt = delta.receivedAt ?? current.receivedAt;
    current.originEventId = delta.originEventId ?? current.originEventId;
    aggregated.set(key, current);
  }

  return [...aggregated.values()];
}

function aggregateSummaryDeltas(deltas: SummaryDelta[]) {
  const aggregated = new Map<string, SummaryDelta>();

  for (const delta of deltas) {
    const key = summaryKey(delta);
    const current = aggregated.get(key) ?? { ...delta, quantity: 0 };
    current.quantity = roundQuantity(current.quantity + delta.quantity);
    aggregated.set(key, current);
  }

  return [...aggregated.values()].filter((delta) => delta.quantity !== 0);
}

function computeShortageQty(params: {
  demandQty: number;
  committedQty: number;
}) {
  return Math.max(0, roundQuantity(params.demandQty - params.committedQty));
}

function uniqueItemBalanceKeys(keys: ItemBalanceKey[]) {
  const unique = new Map<string, ItemBalanceKey>();

  for (const key of keys) {
    unique.set(itemBalanceKey(key), key);
  }

  return [...unique.values()];
}

export async function recomputeAvailableToPromiseForItemsInTx(
  tx: Tx,
  keys: ItemBalanceKey[]
) {
  for (const key of uniqueItemBalanceKeys(keys)) {
    await tx
      .update(inventoryItemBalances)
      .set({
        availableToPromise: sql`
          COALESCE((
            SELECT SUM(${inventoryLotBalances.quantity})
            FROM ${inventoryLotBalances}
            WHERE ${inventoryLotBalances.organizationId} = ${inventoryItemBalances.organizationId}
	              AND ${inventoryLotBalances.locationId} = ${inventoryItemBalances.locationId}
	              AND ${inventoryLotBalances.itemId} = ${inventoryItemBalances.itemId}
	              AND ${inventoryLotBalances.disposition} = 'available'
	          ), 0)
          - ${inventoryItemBalances.demandQty}
          + ${inventoryItemBalances.expectedQty}
        `,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(inventoryItemBalances.organizationId, key.organizationId),
          eq(inventoryItemBalances.locationId, key.locationId),
          eq(inventoryItemBalances.itemId, key.itemId)
        )
      );
  }
}

export async function applyItemBalanceDeltasInTx(
  tx: Tx,
  deltas: ItemBalanceDelta[]
) {
  const aggregated = aggregateItemBalanceDeltas(deltas);

  for (const delta of aggregated) {
    const onHandDelta = normalizeNumeric(delta.onHandDelta);
    const committedDelta = normalizeNumeric(delta.committedDelta);
    const demandDelta = normalizeNumeric(delta.demandDelta);
    const expectedDelta = normalizeNumeric(delta.expectedDelta);
    const shortageQty = normalizeNumeric(
      computeShortageQty({
        demandQty: delta.demandDelta,
        committedQty: delta.committedDelta,
      })
    );

    await tx
      .insert(inventoryItemBalances)
      .values({
        organizationId: delta.organizationId,
        locationId: delta.locationId,
        itemId: delta.itemId,
        onHandQty: onHandDelta,
        committedQty: committedDelta,
        demandQty: demandDelta,
        shortageQty,
        expectedQty: expectedDelta,
        availableToPromise: "0",
        lastVerifiedAt: delta.lastVerifiedAt ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          inventoryItemBalances.organizationId,
          inventoryItemBalances.locationId,
          inventoryItemBalances.itemId,
        ],
        set: {
          onHandQty: sql`${inventoryItemBalances.onHandQty} + ${onHandDelta}`,
          committedQty: sql`${inventoryItemBalances.committedQty} + ${committedDelta}`,
          demandQty: sql`${inventoryItemBalances.demandQty} + ${demandDelta}`,
          shortageQty: sql`GREATEST(
            0,
            (${inventoryItemBalances.demandQty} + ${demandDelta})
            - (${inventoryItemBalances.committedQty} + ${committedDelta})
          )`,
          expectedQty: sql`${inventoryItemBalances.expectedQty} + ${expectedDelta}`,
          lastVerifiedAt:
            delta.lastVerifiedAt === undefined
              ? sql`${inventoryItemBalances.lastVerifiedAt}`
              : delta.lastVerifiedAt,
          updatedAt: new Date(),
        },
      });
  }

  await recomputeAvailableToPromiseForItemsInTx(tx, aggregated);
}

export async function applyLotBalanceDeltasInTx(tx: Tx, deltas: LotBalanceDelta[]) {
  const aggregated = aggregateLotBalanceDeltas(deltas);

  for (const delta of aggregated) {
    const quantityDelta = normalizeNumeric(delta.quantityDelta);
    const [updated] = await tx
      .update(inventoryLotBalances)
      .set({
        quantity: sql`${inventoryLotBalances.quantity} + ${quantityDelta}`,
        stillActive: sql`(${inventoryLotBalances.quantity} + ${quantityDelta}) > 0`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(inventoryLotBalances.organizationId, delta.organizationId),
          eq(inventoryLotBalances.itemId, delta.itemId),
          eq(inventoryLotBalances.locationId, delta.locationId),
          eq(inventoryLotBalances.lotId, delta.lotId),
          eq(inventoryLotBalances.disposition, delta.disposition)
        )
      )
      .returning({ lotId: inventoryLotBalances.lotId });

    if (updated) {
      continue;
    }

    if (delta.quantityDelta < 0 && (!delta.originEventId || !delta.receivedAt)) {
      throw new Error(
        `Cannot decrement missing lot balance ${delta.lotId}.`
      );
    }

    if (!delta.originEventId || !delta.receivedAt) {
      throw new Error(
        `Missing originEventId or receivedAt for new lot balance ${delta.lotId}.`
      );
    }

    await tx.insert(inventoryLotBalances).values({
      organizationId: delta.organizationId,
      locationId: delta.locationId,
      lotId: delta.lotId,
      itemId: delta.itemId,
      disposition: delta.disposition,
      quantity: quantityDelta,
      unitCost: delta.unitCost ?? null,
      receivedAt: delta.receivedAt,
      originEventId: delta.originEventId,
      stillActive: delta.quantityDelta > 0,
    });
  }

  await recomputeAvailableToPromiseForItemsInTx(tx, aggregated);
}

export async function applyReservationSummaryDeltasInTx(
  tx: Tx,
  deltas: SummaryDelta[]
) {
  for (const delta of aggregateSummaryDeltas(deltas)) {
    const quantity = normalizeNumeric(delta.quantity);

    if (delta.quantity > 0) {
      await tx
        .insert(inventoryReservationsSummary)
        .values({
          organizationId: delta.organizationId,
          locationId: delta.locationId,
          itemId: delta.itemId,
          referenceType: delta.referenceType,
          referenceId: delta.referenceId,
          quantity,
        })
        .onConflictDoUpdate({
          target: [
            inventoryReservationsSummary.organizationId,
            inventoryReservationsSummary.locationId,
            inventoryReservationsSummary.itemId,
            inventoryReservationsSummary.referenceType,
            inventoryReservationsSummary.referenceId,
          ],
          set: {
            quantity: sql`${inventoryReservationsSummary.quantity} + ${quantity}`,
            updatedAt: new Date(),
          },
        });
      continue;
    }

    const [updated] = await tx
      .update(inventoryReservationsSummary)
      .set({
        quantity: sql`${inventoryReservationsSummary.quantity} + ${quantity}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(inventoryReservationsSummary.organizationId, delta.organizationId),
          eq(inventoryReservationsSummary.locationId, delta.locationId),
          eq(inventoryReservationsSummary.itemId, delta.itemId),
          eq(inventoryReservationsSummary.referenceType, delta.referenceType),
          eq(inventoryReservationsSummary.referenceId, delta.referenceId)
        )
      )
      .returning({ quantity: inventoryReservationsSummary.quantity });

    if (!updated || parseFloat(updated.quantity) > 0) {
      continue;
    }

    await tx
      .delete(inventoryReservationsSummary)
      .where(
        and(
          eq(inventoryReservationsSummary.organizationId, delta.organizationId),
          eq(inventoryReservationsSummary.locationId, delta.locationId),
          eq(inventoryReservationsSummary.itemId, delta.itemId),
          eq(inventoryReservationsSummary.referenceType, delta.referenceType),
          eq(inventoryReservationsSummary.referenceId, delta.referenceId)
        )
      );
  }
}

export async function applyExpectedSummaryDeltasInTx(
  tx: Tx,
  deltas: SummaryDelta[]
) {
  for (const delta of aggregateSummaryDeltas(deltas)) {
    const quantity = normalizeNumeric(delta.quantity);

    if (delta.quantity > 0) {
      await tx
        .insert(inventoryExpectedSummary)
        .values({
          organizationId: delta.organizationId,
          locationId: delta.locationId,
          itemId: delta.itemId,
          referenceType: delta.referenceType,
          referenceId: delta.referenceId,
          quantity,
        })
        .onConflictDoUpdate({
          target: [
            inventoryExpectedSummary.organizationId,
            inventoryExpectedSummary.locationId,
            inventoryExpectedSummary.itemId,
            inventoryExpectedSummary.referenceType,
            inventoryExpectedSummary.referenceId,
          ],
          set: {
            quantity: sql`${inventoryExpectedSummary.quantity} + ${quantity}`,
            updatedAt: new Date(),
          },
        });
      continue;
    }

    const [updated] = await tx
      .update(inventoryExpectedSummary)
      .set({
        quantity: sql`${inventoryExpectedSummary.quantity} + ${quantity}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(inventoryExpectedSummary.organizationId, delta.organizationId),
          eq(inventoryExpectedSummary.locationId, delta.locationId),
          eq(inventoryExpectedSummary.itemId, delta.itemId),
          eq(inventoryExpectedSummary.referenceType, delta.referenceType),
          eq(inventoryExpectedSummary.referenceId, delta.referenceId)
        )
      )
      .returning({ quantity: inventoryExpectedSummary.quantity });

    if (!updated || parseFloat(updated.quantity) > 0) {
      continue;
    }

    await tx
      .delete(inventoryExpectedSummary)
      .where(
        and(
          eq(inventoryExpectedSummary.organizationId, delta.organizationId),
          eq(inventoryExpectedSummary.locationId, delta.locationId),
          eq(inventoryExpectedSummary.itemId, delta.itemId),
          eq(inventoryExpectedSummary.referenceType, delta.referenceType),
          eq(inventoryExpectedSummary.referenceId, delta.referenceId)
        )
      );
  }
}

export async function applyDemandSummaryDeltasInTx(
  tx: Tx,
  deltas: SummaryDelta[]
) {
  for (const delta of aggregateSummaryDeltas(deltas)) {
    const quantity = normalizeNumeric(delta.quantity);

    if (delta.quantity > 0) {
      await tx
        .insert(inventoryDemandSummary)
        .values({
          organizationId: delta.organizationId,
          locationId: delta.locationId,
          itemId: delta.itemId,
          referenceType: delta.referenceType,
          referenceId: delta.referenceId,
          quantity,
        })
        .onConflictDoUpdate({
          target: [
            inventoryDemandSummary.organizationId,
            inventoryDemandSummary.locationId,
            inventoryDemandSummary.itemId,
            inventoryDemandSummary.referenceType,
            inventoryDemandSummary.referenceId,
          ],
          set: {
            quantity: sql`${inventoryDemandSummary.quantity} + ${quantity}`,
            updatedAt: new Date(),
          },
        });
      continue;
    }

    const [updated] = await tx
      .update(inventoryDemandSummary)
      .set({
        quantity: sql`${inventoryDemandSummary.quantity} + ${quantity}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(inventoryDemandSummary.organizationId, delta.organizationId),
          eq(inventoryDemandSummary.locationId, delta.locationId),
          eq(inventoryDemandSummary.itemId, delta.itemId),
          eq(inventoryDemandSummary.referenceType, delta.referenceType),
          eq(inventoryDemandSummary.referenceId, delta.referenceId)
        )
      )
      .returning({ quantity: inventoryDemandSummary.quantity });

    if (!updated || parseFloat(updated.quantity) > 0) {
      continue;
    }

    await tx
      .delete(inventoryDemandSummary)
      .where(
        and(
          eq(inventoryDemandSummary.organizationId, delta.organizationId),
          eq(inventoryDemandSummary.locationId, delta.locationId),
          eq(inventoryDemandSummary.itemId, delta.itemId),
          eq(inventoryDemandSummary.referenceType, delta.referenceType),
          eq(inventoryDemandSummary.referenceId, delta.referenceId)
        )
      );
  }
}
