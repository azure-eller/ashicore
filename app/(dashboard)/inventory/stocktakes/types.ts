import type {
  StocktakeScopeItemType,
  StocktakeScope,
  StocktakeStatus,
  StocktakeCreationMode,
} from "@/lib/schemas/stocktakes";
import { parseStocktakeScope } from "@/lib/schemas/stocktakes";
import type { ItemType } from "@/app/(dashboard)/inventory/types";
import type { LotTrackingMode } from "@/lib/inventory/lot-tracking";

export type StocktakeScopeOption = {
  value: StocktakeScope;
  label: string;
};

export type StocktakeScopeOptionGroup = {
  label: string;
  options: StocktakeScopeOption[];
};

export type StocktakePreviewItem = {
  id: string;
  name: string;
  displayName: string;
  sku: string | null;
  itemType: ItemType;
  stocktakeType: StocktakeScopeItemType;
  lotTrackingMode: LotTrackingMode;
  category: string | null;
  unitName: string;
  currentQty: string;
};

export function formatScope(scope: StocktakeScope) {
  if (scope === "empty") return "Empty";
  if (scope === "in_stock") return "Items in stock";

  const parsed = parseStocktakeScope(scope);

  if (parsed.kind === "all") {
    return "All Items";
  }

  if (parsed.kind === "type") {
    return formatStocktakeScopeTypeLabel(parsed.itemType);
  }

  if (parsed.kind !== "category") {
    return "All Items";
  }

  return `${formatStocktakeScopeTypeLabel(parsed.itemType)}: ${parsed.category}`;
}

export function buildStocktakeName(scope: StocktakeScope, date = new Date()) {
  const scopeToken = formatScope(scope)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const dateToken = date.toISOString().slice(0, 10);

  return `${scopeToken}_${dateToken}`;
}

export function buildStocktakeModeName(
  mode: StocktakeCreationMode,
  date = new Date()
) {
  const label =
    mode === "empty" ? "empty" : mode === "in_stock" ? "items_in_stock" : "all_items";
  return `${label}_${date.toISOString().slice(0, 10)}`;
}

function formatStocktakeScopeTypeLabel(itemType: StocktakeScopeItemType) {
  if (itemType === "material") return "Materials";
  return "Products";
}

export type StocktakeListRow = {
  id: string;
  name: string;
  scope: StocktakeScope;
  status: StocktakeStatus;
  notes: string | null;
  itemCount: number;
  countedCount: number;
  varianceCount: number;
  completedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type StocktakeDetailLine = {
  id: string;
  itemId: string;
  itemName: string;
  itemSku: string | null;
  itemType: ItemType;
  lotTrackingMode: LotTrackingMode;
  category: string | null;
  unitName: string;
  expectedQty: string;
  countedQty: string | null;
  varianceQty: string | null;
  appliedDeltaQty: string | null;
  notes: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  lots: StocktakeDetailLotLine[];
};

export type StocktakeDetailLotLine = {
  id: string;
  lotId: string | null;
  isFound: boolean;
  lotNumber: string;
  expectedQty: string;
  countedQty: string | null;
  varianceQty: string | null;
  appliedDeltaQty: string | null;
  notes: string | null;
  receivedAt: Date;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export type StocktakeDetail = {
  id: string;
  name: string;
  scope: StocktakeScope;
  status: StocktakeStatus;
  notes: string | null;
  reason: string | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lines: StocktakeDetailLine[];
};

export type StocktakeStaleWarningPayload = {
  items: Array<{
    lineId: string;
    lotLineId?: string | null;
    itemId: string;
    itemName: string;
    lotNumber?: string | null;
    unitName: string;
    expectedQty: string;
    currentQty: string;
    countedQty: string;
  }>;
};

export type StocktakeCompletionPreview = {
  id: string;
  name: string;
  status: StocktakeStatus;
  lines: Array<{
    lineId: string;
    itemId: string;
    itemName: string;
    itemSku: string | null;
    category: string | null;
    unitName: string;
    expectedQty: string;
    currentQty: string;
    countedQty: string;
    varianceQty: string;
    notes: string | null;
    lots: Array<{
      lotLineId: string;
      lotId: string | null;
      isFound: boolean;
      lotNumber: string;
      expectedQty: string;
      currentQty: string;
      countedQty: string;
      varianceQty: string;
      notes: string | null;
    }>;
  }>;
};

export type CloneStocktakeResult = {
  id: string;
  skippedItems: Array<{
    itemName: string;
    itemSku: string | null;
  }>;
};

export function formatCloneSkippedItemsWarning(result: CloneStocktakeResult) {
  if (result.skippedItems.length === 0) return null;
  const names = result.skippedItems
    .slice(0, 5)
    .map((item) => item.itemSku ? `${item.itemName} (${item.itemSku})` : item.itemName)
    .join(", ");
  const remaining = result.skippedItems.length > 5
    ? `, and ${result.skippedItems.length - 5} more`
    : "";
  return `Copied stocktake, but skipped ${result.skippedItems.length} deleted or ineligible item${result.skippedItems.length === 1 ? "" : "s"}: ${names}${remaining}.`;
}
