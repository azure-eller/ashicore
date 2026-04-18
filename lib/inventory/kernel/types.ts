import type { InventoryEventType } from "@/lib/db/schema";

export const INVENTORY_OPERATION_NAMES = [
  "seedOpeningBalance",
  "addExpectedFromPurchase",
  "editExpectedFromPurchase",
  "releaseExpectedFromPurchase",
  "receivePurchaseStock",
  "reserveForSales",
  "releaseReservationForSalesLine",
  "consumeForShipment",
  "addExpectedFromManufacturing",
  "editExpectedFromManufacturing",
  "reserveIngredientsForManufacturing",
  "releaseIngredientReservationForManufacturing",
  "pickManufacturingIngredient",
  "unpickManufacturingIngredient",
  "produceManufacturedStock",
  "cancelManufacturingOrder",
  "manualIncreaseStock",
  "manualDecreaseStock",
  "reconcileStocktakeCount",
  "recordCostBasisChange",
  "repairProjections",
] as const;

export type InventoryOperationName = (typeof INVENTORY_OPERATION_NAMES)[number];

export type InventoryEventInput = {
  organizationId: string;
  locationId: string;
  eventType: InventoryEventType;
  eventSubtype?: string | null;
  itemId: string;
  lotId?: string | null;
  quantity: string;
  unitCost?: string | null;
  extendedCost?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  parentEventId?: string | null;
  idempotencyKey?: string | null;
  actorUserId?: string | null;
  occurredAt?: Date;
  metadata?: Record<string, unknown> | null;
};

export type InventoryOperationResult = {
  eventIds: string[];
  projectionDeltas: {
    itemIds: string[];
    lotIds: string[];
    reservationRefs: string[];
    expectedRefs: string[];
  };
};
