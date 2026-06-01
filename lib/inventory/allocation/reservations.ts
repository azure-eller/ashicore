import { and, eq, inArray, sql } from "drizzle-orm";
import {
  inventoryItemBalances,
  inventoryLotBalances,
  inventoryReservationsSummary,
  lots,
  stockAllocations,
} from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { roundQuantity } from "@/lib/format";
import { getDefaultInventoryLocationInTx } from "@/lib/inventory/kernel";
import { applyReservationReferenceDeltasInTx } from "@/lib/inventory/kernel/operations/common";
import { AllocationError } from "./errors";
import { allocationDemandAdapters } from "./adapters";
import type { AllocationDemandRef, AllocationDemandType } from "./types";
import { compareDemandOrder } from "./priority";

type DemandOrder = {
  demandType: AllocationDemandType;
  demandId: string;
  priorityRank: number | null;
  priorityDate: string | null;
  priorityLabel: string;
};

function demandKey(ref: { demandType: string; demandId: string }) {
  return `${ref.demandType}:${ref.demandId}`;
}

async function loadDemandOrderByKeyInTx(
  tx: Tx,
  params: { organizationId: string; itemId: string }
) {
  const rows = (
    await Promise.all(
      allocationDemandAdapters.map((adapter) =>
        adapter.loadOpenDemandsForItemInTx(tx, {
          organizationId: params.organizationId,
          itemId: params.itemId,
        })
      )
    )
  ).flat();

  return new Map(
    rows.map((row) => [
      demandKey(row),
      {
        demandType: row.demandType,
        demandId: row.demandId,
        priorityRank: row.priorityRank,
        priorityDate: row.priorityDate,
        priorityLabel: row.priorityLabel,
      } satisfies DemandOrder,
    ])
  );
}

async function getReservableAvailableInTx(
  tx: Tx,
  params: { organizationId: string; locationId: string; itemId: string }
) {
  const [reservable] = await tx
    .select({
      quantity: sql<string>`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`,
    })
    .from(inventoryLotBalances)
    .where(
      and(
        eq(inventoryLotBalances.organizationId, params.organizationId),
        eq(inventoryLotBalances.locationId, params.locationId),
        eq(inventoryLotBalances.itemId, params.itemId),
        eq(inventoryLotBalances.disposition, "available"),
        sql`${inventoryLotBalances.quantity} > 0`
      )
    );
  const [reserved] = await tx
    .select({ committedQty: inventoryItemBalances.committedQty })
    .from(inventoryItemBalances)
    .where(
      and(
        eq(inventoryItemBalances.organizationId, params.organizationId),
        eq(inventoryItemBalances.locationId, params.locationId),
        eq(inventoryItemBalances.itemId, params.itemId)
      )
    );

  return Math.max(
    0,
    roundQuantity(
      Number(reservable?.quantity ?? 0) - Number(reserved?.committedQty ?? 0)
    )
  );
}

async function loadReservationRowsInTx(
  tx: Tx,
  params: { organizationId: string; locationId: string; itemId: string }
) {
  return tx
    .select({
      itemId: inventoryReservationsSummary.itemId,
      demandType: inventoryReservationsSummary.referenceType,
      demandId: inventoryReservationsSummary.referenceId,
      quantity: inventoryReservationsSummary.quantity,
    })
    .from(inventoryReservationsSummary)
    .where(
      and(
        eq(inventoryReservationsSummary.organizationId, params.organizationId),
        eq(inventoryReservationsSummary.locationId, params.locationId),
        eq(inventoryReservationsSummary.itemId, params.itemId),
        inArray(inventoryReservationsSummary.referenceType, [
          "sales_order_line",
          "manufacturing_order_ingredient",
        ])
      )
    );
}

async function loadActiveInventoryLotPinTargetsInTx(
  tx: Tx,
  params: { organizationId: string; locationId: string; itemId: string }
) {
  const rows = await tx
    .select({
      demandType: stockAllocations.demandType,
      demandId: stockAllocations.demandId,
      quantity: stockAllocations.quantity,
      lotNumber: lots.lotNumber,
      sourceAvailableQty: inventoryLotBalances.quantity,
    })
    .from(stockAllocations)
    .innerJoin(lots, eq(stockAllocations.sourceId, lots.id))
    .innerJoin(
      inventoryLotBalances,
      and(
        eq(inventoryLotBalances.organizationId, params.organizationId),
        eq(inventoryLotBalances.locationId, params.locationId),
        eq(inventoryLotBalances.itemId, params.itemId),
        eq(inventoryLotBalances.lotId, lots.id),
        eq(inventoryLotBalances.disposition, "available")
      )
    )
    .where(
      and(
        eq(stockAllocations.organizationId, params.organizationId),
        eq(stockAllocations.itemId, params.itemId),
        eq(stockAllocations.sourceType, "inventory_lot"),
        eq(stockAllocations.status, "active"),
        inArray(stockAllocations.demandType, [
          "sales_order_line",
          "manufacturing_order_ingredient",
        ])
      )
    )
    .for("update");

  const targets = new Map<string, {
    demandType: AllocationDemandType;
    demandId: string;
    quantity: number;
    reservationQuantity: number;
  }>();
  for (const row of rows) {
    if (
      row.demandType !== "sales_order_line" &&
      row.demandType !== "manufacturing_order_ingredient"
    ) {
      continue;
    }
    const key = demandKey(row);
    const current = targets.get(key);
    const quantity = Number(row.quantity);
    const sourceAvailableQty = Number(row.sourceAvailableQty);
    const reservationQuantity =
      row.lotNumber === "UNBATCHED"
        ? Math.min(quantity, Math.max(0, sourceAvailableQty))
        : quantity;
    targets.set(key, {
      demandType: row.demandType,
      demandId: row.demandId,
      quantity: roundQuantity((current?.quantity ?? 0) + quantity),
      reservationQuantity: roundQuantity(
        (current?.reservationQuantity ?? 0) + reservationQuantity
      ),
    });
  }

  return targets;
}

export async function reconcileAllocationPinsToReservationsInTx(
  tx: Tx,
  params: {
    organizationId: string;
    itemId: string;
    affectedDemands: AllocationDemandRef[];
    actorUserId?: string | null;
    closedDemandPolicy?: "throw" | "release";
    releaseUnpinnedAffectedDemands?: boolean;
  }
) {
  const location = await getDefaultInventoryLocationInTx(tx, params.organizationId);
  const targets = await loadActiveInventoryLotPinTargetsInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    itemId: params.itemId,
  });

  for (const demand of params.affectedDemands) {
    const key = demandKey(demand);
    if (!targets.has(key) && params.releaseUnpinnedAffectedDemands === true) {
      targets.set(key, { ...demand, quantity: 0, reservationQuantity: 0 });
    }
  }

  if (targets.size === 0) return;

  const demandOrderByKey = await loadDemandOrderByKeyInTx(tx, {
    organizationId: params.organizationId,
    itemId: params.itemId,
  });
  const pinnedKeys = new Set(
    [...targets.entries()]
      .filter(([, target]) => target.reservationQuantity > 0)
      .map(([key]) => key)
  );
  const reservationRows = await loadReservationRowsInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    itemId: params.itemId,
  });
  const currentByKey = new Map(
    reservationRows.map((row) => [demandKey(row), roundQuantity(Number(row.quantity))])
  );

  const surplusDeltas = [...targets.entries()]
    .map(([, target]) => {
      const current = currentByKey.get(demandKey(target)) ?? 0;
      const surplus = roundQuantity(current - target.reservationQuantity);
      return surplus > 0 ? { target, surplus } : null;
    })
    .filter((row): row is NonNullable<typeof row> => row != null)
    .map(({ target, surplus }) => ({
      itemId: params.itemId,
      referenceType: target.demandType,
      referenceId: target.demandId,
      quantity: -surplus,
    }));

  if (surplusDeltas.length > 0) {
    await applyReservationReferenceDeltasInTx(tx, {
      organizationId: params.organizationId,
      locationId: location.id,
      actorUserId: params.actorUserId ?? null,
      eventSubtype: "allocation_pin_reconcile",
      deltas: surplusDeltas,
    });
    for (const delta of surplusDeltas) {
      const key = demandKey({
        demandType: delta.referenceType,
        demandId: delta.referenceId,
      });
      currentByKey.set(
        key,
        roundQuantity((currentByKey.get(key) ?? 0) + delta.quantity)
      );
    }
  }

  const sortedTargets = [...targets.values()]
    .filter((target) => target.reservationQuantity > 0)
    .sort((left, right) => {
      const leftOrder = demandOrderByKey.get(demandKey(left)) ?? left;
      const rightOrder = demandOrderByKey.get(demandKey(right)) ?? right;
      return compareDemandOrder(
        {
          demandType: left.demandType,
          demandId: left.demandId,
          priorityRank: "priorityRank" in leftOrder ? leftOrder.priorityRank : null,
          priorityDate: "priorityDate" in leftOrder ? leftOrder.priorityDate : null,
          priorityLabel: "priorityLabel" in leftOrder ? leftOrder.priorityLabel : left.demandId,
        },
        {
          demandType: right.demandType,
          demandId: right.demandId,
          priorityRank: "priorityRank" in rightOrder ? rightOrder.priorityRank : null,
          priorityDate: "priorityDate" in rightOrder ? rightOrder.priorityDate : null,
          priorityLabel: "priorityLabel" in rightOrder ? rightOrder.priorityLabel : right.demandId,
        }
      );
    });
  const skippedClosedDemandKeys = new Set<string>();

  const releaseCandidates = reservationRows
    .filter((row) => !pinnedKeys.has(demandKey(row)))
    .map((row) => ({
      demandType: row.demandType as AllocationDemandType,
      demandId: row.demandId,
      quantity: currentByKey.get(demandKey(row)) ?? 0,
      order: demandOrderByKey.get(demandKey(row)),
    }))
    .filter(
      (row) =>
        row.quantity > 0 &&
        (row.demandType === "sales_order_line" ||
          row.demandType === "manufacturing_order_ingredient") &&
        row.order != null
    );

  for (const target of sortedTargets) {
    const key = demandKey(target);
    const current = currentByKey.get(key) ?? 0;
    const targetOrder = demandOrderByKey.get(key);
    if (targetOrder == null) {
      if (params.closedDemandPolicy !== "release") {
        throw new AllocationError("Allocation demand is no longer open.", 409);
      }
      const currentReservation = currentByKey.get(key) ?? 0;
      if (currentReservation > 0) {
        await applyReservationReferenceDeltasInTx(tx, {
          organizationId: params.organizationId,
          locationId: location.id,
          actorUserId: params.actorUserId ?? null,
          eventSubtype: "allocation_pin_reconcile",
          deltas: [
            {
              itemId: params.itemId,
              referenceType: target.demandType,
              referenceId: target.demandId,
              quantity: -currentReservation,
            },
          ],
        });
        currentByKey.set(key, 0);
      }
      const now = new Date();
      await tx
        .update(stockAllocations)
        .set({
          status: "cancelled",
          cancelledAt: now,
          cancelledBy: params.actorUserId ?? null,
          updatedAt: now,
          updatedBy: params.actorUserId ?? null,
        })
        .where(
          and(
            eq(stockAllocations.organizationId, params.organizationId),
            eq(stockAllocations.itemId, params.itemId),
            eq(stockAllocations.demandType, target.demandType),
            eq(stockAllocations.demandId, target.demandId),
            eq(stockAllocations.sourceType, "inventory_lot"),
            eq(stockAllocations.status, "active")
          )
        );
      skippedClosedDemandKeys.add(key);
      continue;
    }

    let needed = roundQuantity(target.reservationQuantity - current);
    if (needed <= 0) continue;

    let available = await getReservableAvailableInTx(tx, {
      organizationId: params.organizationId,
      locationId: location.id,
      itemId: params.itemId,
    });

    if (available < needed) {
      const deltas = [];
      const lowerPriorityCandidates = releaseCandidates
        .filter(
          (candidate) =>
            candidate.quantity > 0 &&
            candidate.order != null &&
            compareDemandOrder(candidate.order, targetOrder) > 0
        )
        .sort((left, right) => compareDemandOrder(right.order!, left.order!));

      for (const candidate of lowerPriorityCandidates) {
        if (available >= needed) break;
        const releaseQty = roundQuantity(Math.min(candidate.quantity, needed - available));
        if (releaseQty <= 0) continue;
        candidate.quantity = roundQuantity(candidate.quantity - releaseQty);
        available = roundQuantity(available + releaseQty);
        currentByKey.set(
          demandKey(candidate),
          roundQuantity((currentByKey.get(demandKey(candidate)) ?? 0) - releaseQty)
        );
        deltas.push({
          itemId: params.itemId,
          referenceType: candidate.demandType,
          referenceId: candidate.demandId,
          quantity: -releaseQty,
        });
      }

      if (deltas.length > 0) {
        await applyReservationReferenceDeltasInTx(tx, {
          organizationId: params.organizationId,
          locationId: location.id,
          actorUserId: params.actorUserId ?? null,
          eventSubtype: "allocation_pin_rebalance",
          deltas,
        });
      }
    }

    available = await getReservableAvailableInTx(tx, {
      organizationId: params.organizationId,
      locationId: location.id,
      itemId: params.itemId,
    });
    needed = roundQuantity(target.reservationQuantity - (currentByKey.get(key) ?? 0));
    if (needed > available) {
      throw new AllocationError(
        "Pinned allocation cannot be fully reserved without displacing higher-priority or pinned demand.",
        409
      );
    }

    await applyReservationReferenceDeltasInTx(tx, {
      organizationId: params.organizationId,
      locationId: location.id,
      actorUserId: params.actorUserId ?? null,
      eventSubtype: "allocation_pin_reconcile",
      deltas: [
        {
          itemId: params.itemId,
          referenceType: target.demandType,
          referenceId: target.demandId,
          quantity: needed,
        },
      ],
    });
    const refreshedRows = await loadReservationRowsInTx(tx, {
      organizationId: params.organizationId,
      locationId: location.id,
      itemId: params.itemId,
    });
    const refreshedQty =
      refreshedRows
        .filter((row) => demandKey(row) === key)
        .map((row) => roundQuantity(Number(row.quantity)))
        .at(0) ?? 0;
    currentByKey.set(key, refreshedQty);
    if (roundQuantity(refreshedQty - target.reservationQuantity) < 0) {
      throw new AllocationError(
        "Pinned allocation cannot be fully reserved without displacing higher-priority or pinned demand.",
        409
      );
    }
  }

  const finalRows = await loadReservationRowsInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    itemId: params.itemId,
  });
  const finalByKey = new Map(
    finalRows.map((row) => [demandKey(row), roundQuantity(Number(row.quantity))])
  );

  for (const target of targets.values()) {
    if (skippedClosedDemandKeys.has(demandKey(target))) continue;
    const finalQty = finalByKey.get(demandKey(target)) ?? 0;
    if (roundQuantity(finalQty - target.reservationQuantity) !== 0) {
      throw new AllocationError(
        "Pinned allocation could not be reconciled to inventory reservations.",
        409
      );
    }
  }
}
