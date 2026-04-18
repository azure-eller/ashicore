import { inventoryEvents } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import type { InventoryEventInput } from "./types";

export async function insertInventoryEventsInTx(
  tx: Tx,
  events: InventoryEventInput[]
) {
  if (events.length === 0) {
    return [];
  }

  return tx
    .insert(inventoryEvents)
    .values(
      events.map((event) => ({
        organizationId: event.organizationId,
        locationId: event.locationId,
        eventType: event.eventType,
        eventSubtype: event.eventSubtype ?? null,
        itemId: event.itemId,
        lotId: event.lotId ?? null,
        quantity: event.quantity,
        unitCost: event.unitCost ?? null,
        extendedCost: event.extendedCost ?? null,
        referenceType: event.referenceType ?? null,
        referenceId: event.referenceId ?? null,
        parentEventId: event.parentEventId ?? null,
        idempotencyKey: event.idempotencyKey ?? null,
        actorUserId: event.actorUserId ?? null,
        occurredAt: event.occurredAt ?? new Date(),
        metadata: event.metadata ?? null,
      }))
    )
    .returning({ id: inventoryEvents.id });
}
