import { and, eq, sql } from "drizzle-orm";
import { normalizeNumeric, normalizeNumericScale, roundQuantity } from "@/lib/format";
import {
  type InventoryDisposition,
  type QualityDispositionDecision,
  inventoryLotBalances,
  qualityDispositionEvents,
} from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import {
  applyItemBalanceDeltasInTx,
  applyLotBalanceDeltasInTx,
} from "@/lib/inventory/kernel/projections";
import { insertInventoryEventsInTx } from "@/lib/inventory/kernel/events";
import { lockItemsInTx } from "@/lib/inventory/kernel/locking";
import {
  beginInventoryOperationInTx,
  finishInventoryOperationInTx,
} from "@/lib/inventory/kernel/operations/common";
import { getDefaultInventoryLocationInTx } from "@/lib/inventory/kernel/locations";
import { InventoryDispositionError } from "@/lib/inventory/kernel/errors";
import {
  decrementPhysicalLotQuantityInTx,
  releaseExcessLotAllocationsInTx,
} from "./stock-core";

type LotDispositionBalance = {
  organizationId: string;
  locationId: string;
  itemId: string;
  lotId: string;
  quantity: string;
  unitCost: string | null;
  receivedAt: Date;
  originEventId: string;
};

function unitCostOrZero(value: string | null) {
  return normalizeNumericScale(Number.parseFloat(value ?? "0"), 6);
}

async function getLockedLotDispositionBalanceInTx(
  tx: Tx,
  params: {
    organizationId: string;
    itemId: string;
    locationId: string;
    lotId: string;
    disposition: InventoryDisposition;
  }
): Promise<LotDispositionBalance | null> {
  const [row] = await tx
    .select({
      organizationId: inventoryLotBalances.organizationId,
      locationId: inventoryLotBalances.locationId,
      itemId: inventoryLotBalances.itemId,
      lotId: inventoryLotBalances.lotId,
      quantity: inventoryLotBalances.quantity,
      unitCost: inventoryLotBalances.unitCost,
      receivedAt: inventoryLotBalances.receivedAt,
      originEventId: inventoryLotBalances.originEventId,
    })
    .from(inventoryLotBalances)
    .where(
      and(
        eq(inventoryLotBalances.organizationId, params.organizationId),
        eq(inventoryLotBalances.itemId, params.itemId),
        eq(inventoryLotBalances.locationId, params.locationId),
        eq(inventoryLotBalances.lotId, params.lotId),
        eq(inventoryLotBalances.disposition, params.disposition),
        sql`${inventoryLotBalances.quantity} > 0`
      )
    )
    .for("update");

  return row ?? null;
}

function assertQuantityAvailable(
  balance: LotDispositionBalance | null,
  params: {
    itemId: string;
    lotId: string;
    disposition: InventoryDisposition;
    quantity: number;
  }
): asserts balance is LotDispositionBalance {
  const available = parseFloat(balance?.quantity ?? "0");
  if (!balance || available < params.quantity) {
    throw new InventoryDispositionError(
      `Insufficient ${params.disposition} stock for this lot. Available: ${available}, requested: ${params.quantity}.`,
      409,
      {
        name: "InventoryDispositionError",
        extra: {
          itemId: params.itemId,
          lotId: params.lotId,
          disposition: params.disposition,
          available,
          requested: params.quantity,
        },
      }
    );
  }
}

function dispositionDecision(toDisposition: InventoryDisposition): QualityDispositionDecision {
  if (toDisposition === "available") return "release";
  if (toDisposition === "blocked") return "block";
  return "reject";
}

export async function changeLotDispositionInTx(
  tx: Tx,
  params: {
    organizationId: string;
    itemId: string;
    lotId: string;
    fromDisposition: InventoryDisposition;
    toDisposition: InventoryDisposition;
    quantity: number;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    notes?: string | null;
    referenceType?: string | null;
    referenceId?: string | null;
  }
) {
  const replay = await beginInventoryOperationInTx<{
    eventId: string | null;
    qualityDispositionEventId: string | null;
  }>(tx, {
    organizationId: params.organizationId,
    operationName: "changeLotDisposition",
    idempotencyKey: params.idempotencyKey ?? null,
    payload: {
      itemId: params.itemId,
      lotId: params.lotId,
      fromDisposition: params.fromDisposition,
      toDisposition: params.toDisposition,
      quantity: params.quantity,
      notes: params.notes ?? null,
      referenceType: params.referenceType ?? null,
      referenceId: params.referenceId ?? null,
    },
  });

  if (replay.replayed) {
    return replay.result;
  }

  if (params.fromDisposition === params.toDisposition) {
    throw new InventoryDispositionError(
      "Choose a different disposition.",
      400,
      { name: "InventoryDispositionError" }
    );
  }

  const quantity = roundQuantity(params.quantity);
  const location = await getDefaultInventoryLocationInTx(tx, params.organizationId);
  await lockItemsInTx(tx, [params.itemId]);

  const balance = await getLockedLotDispositionBalanceInTx(tx, {
    organizationId: params.organizationId,
    itemId: params.itemId,
    locationId: location.id,
    lotId: params.lotId,
    disposition: params.fromDisposition,
  });

  assertQuantityAvailable(balance, {
    itemId: params.itemId,
    lotId: params.lotId,
    disposition: params.fromDisposition,
    quantity,
  });

  const unitCost = unitCostOrZero(balance.unitCost);
  const [event] = await insertInventoryEventsInTx(tx, [
    {
      organizationId: params.organizationId,
      locationId: location.id,
      eventType: "quality_disposition_change",
      eventSubtype: dispositionDecision(params.toDisposition),
      itemId: params.itemId,
      lotId: params.lotId,
      quantity: normalizeNumeric(quantity),
      unitCost,
      extendedCost: normalizeNumericScale(quantity * Number.parseFloat(unitCost), 6),
      fromDisposition: params.fromDisposition,
      toDisposition: params.toDisposition,
      referenceType: params.referenceType ?? "lot",
      referenceId: params.referenceId ?? params.lotId,
      actorUserId: params.actorUserId ?? null,
      idempotencyKey: params.idempotencyKey ?? null,
      metadata: params.notes ? { notes: params.notes } : null,
    },
  ]);

  await applyLotBalanceDeltasInTx(tx, [
    {
      organizationId: params.organizationId,
      locationId: location.id,
      lotId: params.lotId,
      itemId: params.itemId,
      disposition: params.fromDisposition,
      quantityDelta: -quantity,
    },
    {
      organizationId: params.organizationId,
      locationId: location.id,
      lotId: params.lotId,
      itemId: params.itemId,
      disposition: params.toDisposition,
      quantityDelta: quantity,
      unitCost,
      receivedAt: balance.receivedAt,
      originEventId: event.id,
    },
  ]);

  if (params.fromDisposition === "available") {
    await releaseExcessLotAllocationsInTx(tx, {
      organizationId: params.organizationId,
      locationId: location.id,
      itemId: params.itemId,
      lotId: params.lotId,
      remainingLotQuantity: roundQuantity(Number(balance.quantity) - quantity),
      actorUserId: params.actorUserId ?? null,
    });
  }

  const [qualityEvent] = await tx
    .insert(qualityDispositionEvents)
    .values({
      organizationId: params.organizationId,
      locationId: location.id,
      itemId: params.itemId,
      lotId: params.lotId,
      inventoryEventId: event.id,
      decision: dispositionDecision(params.toDisposition),
      fromDisposition: params.fromDisposition,
      toDisposition: params.toDisposition,
      quantity: normalizeNumeric(quantity),
      referenceType: params.referenceType ?? null,
      referenceId: params.referenceId ?? null,
      notes: params.notes ?? null,
      actorUserId: params.actorUserId ?? null,
      occurredAt: new Date(),
    })
    .returning({ id: qualityDispositionEvents.id });

  const result = {
    eventId: event.id,
    qualityDispositionEventId: qualityEvent.id,
  };

  await finishInventoryOperationInTx(tx, {
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey ?? null,
    firstEventId: event.id,
    result,
  });

  return result;
}

export async function scrapLotDispositionInTx(
  tx: Tx,
  params: {
    organizationId: string;
    itemId: string;
    lotId: string;
    fromDisposition: InventoryDisposition;
    quantity: number;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    notes?: string | null;
    referenceType?: string | null;
    referenceId?: string | null;
  }
) {
  const replay = await beginInventoryOperationInTx<{
    eventId: string;
    qualityDispositionEventId: string;
  }>(tx, {
    organizationId: params.organizationId,
    operationName: "scrapLotDisposition",
    idempotencyKey: params.idempotencyKey ?? null,
    payload: {
      itemId: params.itemId,
      lotId: params.lotId,
      fromDisposition: params.fromDisposition,
      quantity: params.quantity,
      notes: params.notes ?? null,
      referenceType: params.referenceType ?? null,
      referenceId: params.referenceId ?? null,
    },
  });

  if (replay.replayed) {
    return replay.result;
  }

  const quantity = roundQuantity(params.quantity);
  const location = await getDefaultInventoryLocationInTx(tx, params.organizationId);
  await lockItemsInTx(tx, [params.itemId]);

  const balance = await getLockedLotDispositionBalanceInTx(tx, {
    organizationId: params.organizationId,
    itemId: params.itemId,
    locationId: location.id,
    lotId: params.lotId,
    disposition: params.fromDisposition,
  });

  assertQuantityAvailable(balance, {
    itemId: params.itemId,
    lotId: params.lotId,
    disposition: params.fromDisposition,
    quantity,
  });

  const unitCost = unitCostOrZero(balance.unitCost);
  const [event] = await insertInventoryEventsInTx(tx, [
    {
      organizationId: params.organizationId,
      locationId: location.id,
      eventType: "quality_scrap",
      eventSubtype: "scrap",
      itemId: params.itemId,
      lotId: params.lotId,
      quantity: normalizeNumeric(quantity),
      unitCost,
      extendedCost: normalizeNumericScale(quantity * Number.parseFloat(unitCost), 6),
      fromDisposition: params.fromDisposition,
      referenceType: params.referenceType ?? "lot",
      referenceId: params.referenceId ?? params.lotId,
      actorUserId: params.actorUserId ?? null,
      idempotencyKey: params.idempotencyKey ?? null,
      metadata: params.notes ? { notes: params.notes } : null,
    },
  ]);

  await applyLotBalanceDeltasInTx(tx, [
    {
      organizationId: params.organizationId,
      locationId: location.id,
      lotId: params.lotId,
      itemId: params.itemId,
      disposition: params.fromDisposition,
      quantityDelta: -quantity,
    },
  ]);

  if (params.fromDisposition === "available") {
    await releaseExcessLotAllocationsInTx(tx, {
      organizationId: params.organizationId,
      locationId: location.id,
      itemId: params.itemId,
      lotId: params.lotId,
      remainingLotQuantity: roundQuantity(Number(balance.quantity) - quantity),
      actorUserId: params.actorUserId ?? null,
    });
  }

  await applyItemBalanceDeltasInTx(tx, [
    {
      organizationId: params.organizationId,
      locationId: location.id,
      itemId: params.itemId,
      onHandDelta: -quantity,
    },
  ]);

  const physicalLotUpdated = await decrementPhysicalLotQuantityInTx(tx, {
    organizationId: params.organizationId,
    itemId: params.itemId,
    lotId: params.lotId,
    quantity,
  });

  if (!physicalLotUpdated) {
    throw new InventoryDispositionError("Insufficient physical stock for this lot.", 409, {
      name: "InventoryDispositionError",
      extra: {
        itemId: params.itemId,
        lotId: params.lotId,
        disposition: params.fromDisposition,
        requested: quantity,
      },
    });
  }

  const [qualityEvent] = await tx
    .insert(qualityDispositionEvents)
    .values({
      organizationId: params.organizationId,
      locationId: location.id,
      itemId: params.itemId,
      lotId: params.lotId,
      inventoryEventId: event.id,
      decision: "scrap",
      fromDisposition: params.fromDisposition,
      toDisposition: null,
      quantity: normalizeNumeric(quantity),
      referenceType: params.referenceType ?? null,
      referenceId: params.referenceId ?? null,
      notes: params.notes ?? null,
      actorUserId: params.actorUserId ?? null,
      occurredAt: new Date(),
    })
    .returning({ id: qualityDispositionEvents.id });

  const result = {
    eventId: event.id,
    qualityDispositionEventId: qualityEvent.id,
  };

  await finishInventoryOperationInTx(tx, {
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey ?? null,
    firstEventId: event.id,
    result,
  });

  return result;
}
