import type { Tx } from "@/lib/db/with-org-context";
import { inventoryEvents } from "@/lib/db/schema";
import { getDefaultInventoryLocationInTx } from "@/lib/inventory/kernel/locations";
import {
  beginInventoryOperationInTx,
  finishInventoryOperationInTx,
} from "@/lib/inventory/kernel/operations/common";
import {
  consumeStockFifoInTx,
  createPositiveStockEventInTx,
  resolvePositiveStockUnitCostInTx,
  updateMaterialCurrentStockUnitCostInTx,
} from "@/lib/inventory/kernel/operations/stock-core";

export async function seedOpeningBalanceInTx(
  tx: Tx,
  params: {
    organizationId: string;
    itemId: string;
    quantity: number;
    unitCost: string;
    lotNumber?: string | null;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    receivedAt?: Date;
  }
) {
  const replay = await beginInventoryOperationInTx<{ lotId: string; eventId: string }>(tx, {
    organizationId: params.organizationId,
    operationName: "seedOpeningBalance",
    idempotencyKey: params.idempotencyKey ?? null,
    payload: {
      itemId: params.itemId,
      quantity: params.quantity,
      unitCost: params.unitCost,
      lotNumber: params.lotNumber ?? null,
      receivedAt: params.receivedAt?.toISOString() ?? null,
    },
  });

  if (replay.replayed) {
    return replay.result;
  }

  const location = await getDefaultInventoryLocationInTx(tx, params.organizationId);
  const created = await createPositiveStockEventInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    itemId: params.itemId,
    quantity: params.quantity,
    unitCost: params.unitCost,
    eventType: "opening_balance",
    referenceType: "seed",
    referenceId: null,
    actorUserId: params.actorUserId ?? null,
    idempotencyKey: params.idempotencyKey ?? null,
    lotNumber: params.lotNumber ?? null,
    receivedAt: params.receivedAt,
    occurredAt: params.receivedAt,
  });

  const result = {
    lotId: created.lotId,
    eventId: created.eventId,
  };

  await updateMaterialCurrentStockUnitCostInTx(tx, {
    itemId: params.itemId,
    currentStockUnitCost: params.unitCost,
  });

  await finishInventoryOperationInTx(tx, {
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey ?? null,
    firstEventId: created.eventId,
    result,
  });

  return result;
}

export async function manualIncreaseStockInTx(
  tx: Tx,
  params: {
    organizationId: string;
    itemId: string;
    quantity: number;
    actorUserId?: string | null;
    unitCost?: string | null;
    note?: string | null;
    idempotencyKey?: string | null;
  }
) {
  const replay = await beginInventoryOperationInTx<{ lotId: string; eventId: string }>(tx, {
    organizationId: params.organizationId,
    operationName: "manualIncreaseStock",
    idempotencyKey: params.idempotencyKey ?? null,
    payload: {
      itemId: params.itemId,
      quantity: params.quantity,
      unitCost: params.unitCost ?? null,
      note: params.note ?? null,
    },
  });

  if (replay.replayed) {
    return replay.result;
  }

  const location = await getDefaultInventoryLocationInTx(tx, params.organizationId);
  const unitCost = await resolvePositiveStockUnitCostInTx(tx, {
    itemId: params.itemId,
    explicitUnitCost: params.unitCost ?? undefined,
    reason: "material_default_price",
  });
  const created = await createPositiveStockEventInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    itemId: params.itemId,
    quantity: params.quantity,
    unitCost,
    eventType: "manual_adjustment_increase",
    eventSubtype: "manual_adjustment",
    referenceType: "item",
    referenceId: params.itemId,
    actorUserId: params.actorUserId ?? null,
    idempotencyKey: params.idempotencyKey ?? null,
    metadata: params.note ? { note: params.note } : null,
  });

  const result = {
    lotId: created.lotId,
    eventId: created.eventId,
  };

  await finishInventoryOperationInTx(tx, {
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey ?? null,
    firstEventId: created.eventId,
    result,
  });

  return result;
}

export async function manualDecreaseStockInTx(
  tx: Tx,
  params: {
    organizationId: string;
    itemId: string;
    quantity: number;
    actorUserId?: string | null;
    note?: string | null;
    idempotencyKey?: string | null;
  }
) {
  const replay = await beginInventoryOperationInTx<{ eventIds: string[] }>(tx, {
    organizationId: params.organizationId,
    operationName: "manualDecreaseStock",
    idempotencyKey: params.idempotencyKey ?? null,
    payload: {
      itemId: params.itemId,
      quantity: params.quantity,
      note: params.note ?? null,
    },
  });

  if (replay.replayed) {
    return replay.result;
  }

  const location = await getDefaultInventoryLocationInTx(tx, params.organizationId);
  const consumed = await consumeStockFifoInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    itemId: params.itemId,
    quantity: params.quantity,
    eventType: "manual_adjustment_decrease",
    eventSubtype: "manual_adjustment",
    referenceType: "item",
    referenceId: params.itemId,
    actorUserId: params.actorUserId ?? null,
    idempotencyKey: params.idempotencyKey ?? null,
    metadata: params.note ? { note: params.note } : null,
  });

  const result = { eventIds: consumed.eventIds };

  await finishInventoryOperationInTx(tx, {
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey ?? null,
    firstEventId: consumed.eventIds[0] ?? null,
    result,
  });

  return result;
}

export async function recordCostBasisChangeInTx(
  tx: Tx,
  params: {
    organizationId: string;
    itemId: string;
    actorUserId?: string | null;
    eventSubtype:
      | "default_purchase_price"
      | "current_stock_unit_cost_override"
      | "purchase_unit_config"
      | "bom_locked"
      | "bom_unlocked"
      | "bom_edited";
    metadata: Record<string, unknown>;
    idempotencyKey?: string | null;
  }
) {
  const replay = await beginInventoryOperationInTx<{ itemId: string }>(tx, {
    organizationId: params.organizationId,
    operationName: "recordCostBasisChange",
    idempotencyKey: params.idempotencyKey ?? null,
    payload: {
      itemId: params.itemId,
      eventSubtype: params.eventSubtype,
      metadata: params.metadata,
    },
  });

  if (replay.replayed) {
    return replay.result;
  }

  const location = await getDefaultInventoryLocationInTx(tx, params.organizationId);
  const [event] = await tx
    .insert(inventoryEvents)
    .values({
      organizationId: params.organizationId,
      locationId: location.id,
      eventType: "cost_basis_change",
      eventSubtype: params.eventSubtype,
      itemId: params.itemId,
      quantity: "0",
      referenceType: "item",
      referenceId: params.itemId,
      actorUserId: params.actorUserId ?? null,
      idempotencyKey: params.idempotencyKey ?? null,
      metadata: params.metadata,
    })
    .returning({ id: inventoryEvents.id });

  const result = { itemId: params.itemId };

  await finishInventoryOperationInTx(tx, {
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey ?? null,
    firstEventId: event.id,
    result,
  });

  return result;
}
