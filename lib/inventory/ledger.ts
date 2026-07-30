import type { InventoryEventType } from "@/lib/db/schema";
import { normalizeNumeric } from "@/lib/format";
import { appendSearchParams } from "@/lib/routing/search-params";

export const INVENTORY_LEDGER_SCOPE_VALUES = ["stock", "all"] as const;
export type InventoryLedgerScope = (typeof INVENTORY_LEDGER_SCOPE_VALUES)[number];

export const INVENTORY_LEDGER_EVENT_CLASSES = [
  "stock",
  "demand",
  "expected",
  "quality",
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
  "inventory_transfer",
] as const;
export type InventoryLedgerSourceType =
  (typeof INVENTORY_LEDGER_SOURCE_TYPES)[number];

export const INVENTORY_LEDGER_BALANCE_DIMENSIONS = [
  "on_hand",
  "demand",
  "expected",
  "none",
] as const;
export type InventoryLedgerBalanceDimension =
  (typeof INVENTORY_LEDGER_BALANCE_DIMENSIONS)[number];

export type InventoryLedgerMetadataSummaryEntry = {
  label: string;
  value: string;
};

const STOCK_INCREASE_TYPES: ReadonlySet<InventoryEventType> = new Set([
  "opening_balance",
  "purchase_receipt",
  "manufacturing_output",
  "manual_adjustment_increase",
  "stocktake_gain",
  "manufacturing_variance_gain",
  "unpick_restock",
  "transfer_in",
]);

const STOCK_DECREASE_TYPES: ReadonlySet<InventoryEventType> = new Set([
  "manual_adjustment_decrease",
  "stocktake_loss",
  "sales_consumption",
  "manufacturing_ingredient_consumption",
  "manufacturing_variance_loss",
  "quality_scrap",
  "transfer_out",
]);

const QUALITY_EVENT_TYPES: ReadonlySet<InventoryEventType> = new Set([
  "quality_disposition_change",
  "quality_scrap",
]);

const DEMAND_EVENT_TYPES: ReadonlySet<InventoryEventType> = new Set([
  "demand_increase",
  "demand_release",
]);

const EXPECTED_EVENT_TYPES: ReadonlySet<InventoryEventType> = new Set([
  "expected_increase",
  "expected_release",
]);

const NON_DELTA_EVENT_TYPES: ReadonlySet<InventoryEventType> = new Set([
  "stocktake_verification",
  "cost_basis_change",
  "landed_cost_revaluation",
  "quality_disposition_change",
]);

const EVENT_LABELS: Record<InventoryEventType, string> = {
  opening_balance: "Opening balance",
  purchase_receipt: "Purchase receipt",
  manufacturing_output: "Manufacturing output",
  manual_adjustment_increase: "Manual stock increase",
  stocktake_gain: "Stocktake adjustment",
  manufacturing_variance_gain: "Manufacturing variance gain",
  manual_adjustment_decrease: "Manual stock decrease",
  stocktake_loss: "Stocktake adjustment",
  sales_consumption: "Sales shipment",
  manufacturing_ingredient_consumption: "Manufacturing material used",
  manufacturing_variance_loss: "Manufacturing variance loss",
  quality_scrap: "Quality scrap",
  unpick_restock: "Unpick restock",
  transfer_out: "Transfer out",
  transfer_in: "Transfer in",
  quality_disposition_change: "Quality disposition change",
  demand_increase: "Customer demand increase",
  demand_release: "Customer demand release",
  expected_increase: "Expected supply increase",
  expected_release: "Expected supply release",
  cost_basis_change: "Cost basis change",
  landed_cost_revaluation: "Landed cost revaluation",
  stocktake_verification: "Stocktake verification",
};

const SUMMARY_ACTIONS: Record<InventoryEventType, string> = {
  opening_balance: "recorded opening stock for",
  purchase_receipt: "received",
  manufacturing_output: "produced",
  manual_adjustment_increase: "manually increased",
  stocktake_gain: "increased stocktake count for",
  manufacturing_variance_gain: "recorded manufacturing variance gain for",
  manual_adjustment_decrease: "manually decreased",
  stocktake_loss: "decreased stocktake count for",
  sales_consumption: "shipped",
  manufacturing_ingredient_consumption: "used",
  manufacturing_variance_loss: "recorded manufacturing variance loss for",
  quality_scrap: "scrapped",
  unpick_restock: "returned picked material for",
  transfer_out: "transferred out",
  transfer_in: "transferred in",
  quality_disposition_change: "changed quality disposition for",
  demand_increase: "added customer demand for",
  demand_release: "released customer demand for",
  expected_increase: "expected",
  expected_release: "released expected supply for",
  cost_basis_change: "updated cost basis for",
  landed_cost_revaluation: "revalued landed cost for",
  stocktake_verification: "verified stocktake count for",
};

const EVENT_CLASS_LABELS: Record<InventoryLedgerEventClass, string> = {
  stock: "Stock",
  demand: "Demand",
  expected: "Expected",
  quality: "Quality",
  verification: "Verification",
  cost: "Cost",
};

const MOVEMENT_CATEGORY_LABELS: Record<InventoryLedgerEventClass, string> = {
  stock: "Stock movements",
  demand: "Demand",
  expected: "Expected supply",
  quality: "Quality decisions",
  verification: "Verification",
  cost: "Cost changes",
};

const BALANCE_DIMENSION_LABELS: Record<InventoryLedgerBalanceDimension, string> = {
  on_hand: "On-hand",
  demand: "Demand",
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
  inventory_transfer: "Transfer",
};

export function getInventoryLedgerEventClass(
  eventType: InventoryEventType
): InventoryLedgerEventClass {
  if (QUALITY_EVENT_TYPES.has(eventType)) {
    return "quality";
  }

  if (STOCK_INCREASE_TYPES.has(eventType) || STOCK_DECREASE_TYPES.has(eventType)) {
    return "stock";
  }

  if (DEMAND_EVENT_TYPES.has(eventType)) {
    return "demand";
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

  if (DEMAND_EVENT_TYPES.has(eventType)) {
    return "demand";
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
    eventType === "demand_release" ||
    eventType === "expected_release"
  ) {
    return normalizeNumeric(-Math.abs(parsed));
  }

  return normalizeNumeric(Math.abs(parsed));
}

export function formatInventoryLedgerEventLabel(eventType: InventoryEventType) {
  return EVENT_LABELS[eventType];
}

export function formatInventoryLedgerSummaryAction(eventType: InventoryEventType) {
  return SUMMARY_ACTIONS[eventType];
}

export function formatInventoryLedgerEventClass(
  eventClass: InventoryLedgerEventClass
) {
  return EVENT_CLASS_LABELS[eventClass];
}

export function formatInventoryLedgerMovementCategory(
  eventClass: InventoryLedgerEventClass
) {
  return MOVEMENT_CATEGORY_LABELS[eventClass];
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
  return appendSearchParams("/inventory/ledger", {
    itemId: filters.itemId,
    documentType: filters.documentType,
    scope: filters.documentType ? "all" : null,
    documentId: filters.documentId,
  });
}

export function summarizeInventoryLedgerMetadata(
  metadata: Record<string, unknown> | null
): InventoryLedgerMetadataSummaryEntry[] {
  if (!metadata) {
    return [];
  }

  const summary: InventoryLedgerMetadataSummaryEntry[] = [];
  const handledKeys = new Set<string>();

  const mark = (...keys: string[]) => {
    for (const key of keys) {
      handledKeys.add(key);
    }
  };

  const add = (label: string, value: string, ...keys: string[]) => {
    summary.push({ label, value });
    mark(...keys);
  };

  if (typeof metadata.lotNumber === "string") {
    add("Lot number", metadata.lotNumber, "lotNumber");
  }

  if ("note" in metadata || "notes" in metadata) {
    add("Internal note", "Hidden", "note", "notes");
  }

  if ("revisionNote" in metadata) {
    add("Revision note", "Hidden", "revisionNote");
  }

  if ("stocktakeId" in metadata) {
    add("Stocktake link", "Resolved from source document", "stocktakeId");
  }

  if ("purchaseOrderLineId" in metadata) {
    add("Purchase line", "Resolved from source document", "purchaseOrderLineId");
  }

  if (metadata.costingMode === "fifo_lot") {
    add("Costing mode", "FIFO lot", "costingMode");
  } else if (metadata.costingMode === "mac_bucket") {
    add("Costing mode", "Moving average", "costingMode");
  }

  if (metadata.allocationBasis === "by_value") {
    add("Allocation basis", "Line value", "allocationBasis");
  } else if (metadata.allocationBasis === "by_quantity") {
    add("Allocation basis", "Purchase quantity", "allocationBasis");
  } else if (metadata.allocationBasis === "mixed") {
    add(
      "Allocation basis",
      "Mixed: line value + purchase quantity",
      "allocationBasis",
    );
  } else if (metadata.allocationBasis === "by_weight") {
    add("Allocation basis", "Weight", "allocationBasis");
  }

  if (typeof metadata.revaluedQuantity === "string") {
    add("Revalued quantity", metadata.revaluedQuantity, "revaluedQuantity");
  }

  if (
    typeof metadata.previousUnitCost === "string" &&
    typeof metadata.newUnitCost === "string"
  ) {
    add(
      "Unit cost change",
      `${metadata.previousUnitCost} -> ${metadata.newUnitCost}`,
      "previousUnitCost",
      "newUnitCost"
    );
  }

  if ("salesOrderLineId" in metadata) {
    add("Sales line", "Resolved from source document", "salesOrderLineId");
  }

  if ("manufacturingOrderIngredientId" in metadata) {
    add(
      "Manufacturing ingredient",
      "Resolved from source document",
      "manufacturingOrderIngredientId"
    );
  }

  if (typeof metadata.componentCount === "number") {
    add("Components", String(metadata.componentCount), "componentCount");
  }

  if (typeof metadata.ingredientCostTotal === "string") {
    add("Ingredient cost total", metadata.ingredientCostTotal, "ingredientCostTotal");
  }

  if (typeof metadata.overheadCostTotal === "string") {
    add("Overhead cost total", metadata.overheadCostTotal, "overheadCostTotal");
  }

  if (Array.isArray(metadata.ingredientIds)) {
    add("Ingredient lines", String(metadata.ingredientIds.length), "ingredientIds");
  }

  if ("before" in metadata || "after" in metadata) {
    add("Change details", "Captured", "before", "after");
  }

  const hasHiddenMetadata = Object.keys(metadata).some(
    (key) => !handledKeys.has(key)
  );

  if (hasHiddenMetadata) {
    add("Additional metadata", "Hidden");
  }

  return summary;
}
