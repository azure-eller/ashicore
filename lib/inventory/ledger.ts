import type { InventoryEventType } from "@/lib/db/schema";
import { normalizeNumeric } from "@/lib/format";

export const INVENTORY_LEDGER_SCOPE_VALUES = ["stock", "all"] as const;
export type InventoryLedgerScope = (typeof INVENTORY_LEDGER_SCOPE_VALUES)[number];

export const INVENTORY_LEDGER_EVENT_CLASSES = [
  "stock",
  "reservation",
  "expected",
  "verification",
  "cost",
] as const;
export type InventoryLedgerEventClass =
  (typeof INVENTORY_LEDGER_EVENT_CLASSES)[number];

export const INVENTORY_LEDGER_SOURCE_TYPES = [
  "purchase_order",
  "sales_order",
  "manufacturing_order",
  "stocktake",
  "item",
  "seed",
] as const;
export type InventoryLedgerSourceType =
  (typeof INVENTORY_LEDGER_SOURCE_TYPES)[number];

export const INVENTORY_LEDGER_BALANCE_DIMENSIONS = [
  "on_hand",
  "committed",
  "expected",
  "none",
] as const;
export type InventoryLedgerBalanceDimension =
  (typeof INVENTORY_LEDGER_BALANCE_DIMENSIONS)[number];

const STOCK_INCREASE_TYPES: ReadonlySet<InventoryEventType> = new Set([
  "opening_balance",
  "purchase_receipt",
  "manufacturing_output",
  "manual_adjustment_increase",
  "stocktake_gain",
  "manufacturing_variance_gain",
  "unpick_restock",
]);

const STOCK_DECREASE_TYPES: ReadonlySet<InventoryEventType> = new Set([
  "manual_adjustment_decrease",
  "stocktake_loss",
  "sales_consumption",
  "manufacturing_ingredient_consumption",
  "manufacturing_variance_loss",
]);

const RESERVATION_EVENT_TYPES: ReadonlySet<InventoryEventType> = new Set([
  "reservation_increase",
  "reservation_release",
]);

const EXPECTED_EVENT_TYPES: ReadonlySet<InventoryEventType> = new Set([
  "expected_increase",
  "expected_release",
]);

const NON_DELTA_EVENT_TYPES: ReadonlySet<InventoryEventType> = new Set([
  "stocktake_verification",
  "cost_basis_change",
]);

const EVENT_LABELS: Record<InventoryEventType, string> = {
  opening_balance: "Opening balance",
  purchase_receipt: "Purchase receipt",
  manufacturing_output: "Manufacturing output",
  manual_adjustment_increase: "Manual stock increase",
  stocktake_gain: "Stocktake gain",
  manufacturing_variance_gain: "Manufacturing variance gain",
  manual_adjustment_decrease: "Manual stock decrease",
  stocktake_loss: "Stocktake loss",
  sales_consumption: "Sales shipment",
  manufacturing_ingredient_consumption: "Manufacturing pick",
  manufacturing_variance_loss: "Manufacturing variance loss",
  unpick_restock: "Unpick restock",
  reservation_increase: "Reservation increase",
  reservation_release: "Reservation release",
  expected_increase: "Expected supply increase",
  expected_release: "Expected supply release",
  cost_basis_change: "Cost basis change",
  stocktake_verification: "Stocktake verification",
};

const EVENT_CLASS_LABELS: Record<InventoryLedgerEventClass, string> = {
  stock: "Stock",
  reservation: "Reservation",
  expected: "Expected",
  verification: "Verification",
  cost: "Cost",
};

const BALANCE_DIMENSION_LABELS: Record<InventoryLedgerBalanceDimension, string> = {
  on_hand: "On-hand",
  committed: "Committed",
  expected: "Expected",
  none: "No quantity change",
};

const SOURCE_TYPE_LABELS: Record<InventoryLedgerSourceType, string> = {
  purchase_order: "Purchase order",
  sales_order: "Sales order",
  manufacturing_order: "Manufacturing order",
  stocktake: "Stocktake",
  item: "Item",
  seed: "Seed",
};

export function getInventoryLedgerEventClass(
  eventType: InventoryEventType
): InventoryLedgerEventClass {
  if (STOCK_INCREASE_TYPES.has(eventType) || STOCK_DECREASE_TYPES.has(eventType)) {
    return "stock";
  }

  if (RESERVATION_EVENT_TYPES.has(eventType)) {
    return "reservation";
  }

  if (EXPECTED_EVENT_TYPES.has(eventType)) {
    return "expected";
  }

  if (eventType === "stocktake_verification") {
    return "verification";
  }

  return "cost";
}

export function isStockAffectingInventoryEvent(eventType: InventoryEventType) {
  return STOCK_INCREASE_TYPES.has(eventType) || STOCK_DECREASE_TYPES.has(eventType);
}

export function getInventoryLedgerBalanceDimension(
  eventType: InventoryEventType
): InventoryLedgerBalanceDimension {
  if (STOCK_INCREASE_TYPES.has(eventType) || STOCK_DECREASE_TYPES.has(eventType)) {
    return "on_hand";
  }

  if (RESERVATION_EVENT_TYPES.has(eventType)) {
    return "committed";
  }

  if (EXPECTED_EVENT_TYPES.has(eventType)) {
    return "expected";
  }

  return "none";
}

export function getSignedInventoryLedgerQuantity(
  eventType: InventoryEventType,
  quantity: string
) {
  const parsed = parseFloat(quantity);

  if (!Number.isFinite(parsed) || NON_DELTA_EVENT_TYPES.has(eventType)) {
    return "0";
  }

  if (
    STOCK_DECREASE_TYPES.has(eventType) ||
    eventType === "reservation_release" ||
    eventType === "expected_release"
  ) {
    return normalizeNumeric(-Math.abs(parsed));
  }

  return normalizeNumeric(Math.abs(parsed));
}

export function formatInventoryLedgerEventLabel(eventType: InventoryEventType) {
  return EVENT_LABELS[eventType];
}

export function formatInventoryLedgerEventClass(
  eventClass: InventoryLedgerEventClass
) {
  return EVENT_CLASS_LABELS[eventClass];
}

export function formatInventoryLedgerBalanceDimension(
  balanceDimension: InventoryLedgerBalanceDimension
) {
  return BALANCE_DIMENSION_LABELS[balanceDimension];
}

export function formatInventoryLedgerSourceType(
  sourceType: InventoryLedgerSourceType
) {
  return SOURCE_TYPE_LABELS[sourceType];
}

export function buildInventoryLedgerHref(filters: {
  itemId?: string | null;
  documentType?: InventoryLedgerSourceType | null;
  documentId?: string | null;
}) {
  const searchParams = new URLSearchParams();

  if (filters.itemId) {
    searchParams.set("itemId", filters.itemId);
  }

  if (filters.documentType) {
    searchParams.set("documentType", filters.documentType);
  }

  if (filters.documentId) {
    searchParams.set("documentId", filters.documentId);
  }

  const query = searchParams.toString();
  return query ? `/inventory/ledger?${query}` : "/inventory/ledger";
}
