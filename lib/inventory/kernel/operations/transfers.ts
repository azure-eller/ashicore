import type { Tx } from "@/lib/db/with-org-context";
import { resolveInventoryLocationInTx } from "@/lib/inventory/kernel/locations";
import { lockItemsInTx } from "@/lib/inventory/kernel/locking";
import {
  appendPositiveStockToExistingLotInTx,
  consumeStockFifoInTx,
} from "./stock-core";

export type TransferStockLine = {
  itemId: string;
  quantity: number;
};

export type TransferStockResult = {
  transferId: string;
  eventIds: string[];
};

// Idempotency lives in the DAL (createInventoryTransfer), which claims the
// client key before inserting the transfer document and calling this op —
// the document insert and stock movement replay as one unit.
export async function transferStockInTx(
  tx: Tx,
  params: {
    organizationId: string;
    transferId: string;
    fromLocationId: string;
    toLocationId: string;
    lines: TransferStockLine[];
    actorUserId?: string | null;
    occurredAt?: Date;
  }
): Promise<TransferStockResult> {
  if (params.fromLocationId === params.toLocationId) {
    throw new Error("Transfer source and destination must differ.");
  }
  if (params.lines.length === 0) {
    throw new Error("Transfer requires at least one line.");
  }

  const fromLocation = await resolveInventoryLocationInTx(
    tx,
    params.organizationId,
    params.fromLocationId
  );
  const toLocation = await resolveInventoryLocationInTx(
    tx,
    params.organizationId,
    params.toLocationId
  );

  await lockItemsInTx(tx, params.lines.map((line) => line.itemId));

  const eventIds: string[] = [];

  for (const line of params.lines) {
    if (!(line.quantity > 0)) {
      throw new Error("Transfer line quantity must be positive.");
    }

    // Available-quantity enforcement (positive balances minus negative-stock
    // debt at the source location) lives in consumeStockFifoInTx, which
    // throws InsufficientStockError without allowNegativeStock.
    const consumed = await consumeStockFifoInTx(tx, {
      organizationId: params.organizationId,
      locationId: fromLocation.id,
      itemId: line.itemId,
      quantity: line.quantity,
      eventType: "transfer_out",
      referenceType: "inventory_transfer",
      referenceId: params.transferId,
      actorUserId: params.actorUserId ?? null,
      occurredAt: params.occurredAt,
    });

    for (const [index, allocation] of consumed.allocations.entries()) {
      const appended = await appendPositiveStockToExistingLotInTx(tx, {
        organizationId: params.organizationId,
        locationId: toLocation.id,
        itemId: line.itemId,
        lotId: allocation.lotId,
        quantity: allocation.quantity,
        unitCost: String(allocation.unitCost),
        eventType: "transfer_in",
        referenceType: "inventory_transfer",
        referenceId: params.transferId,
        parentEventId: consumed.eventIds[index] ?? null,
        actorUserId: params.actorUserId ?? null,
        occurredAt: params.occurredAt,
      });
      eventIds.push(appended.eventId);
    }

    eventIds.push(...consumed.eventIds);
  }

  return {
    transferId: params.transferId,
    eventIds,
  };
}
