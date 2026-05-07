import type {
  StocktakeScopeItemType,
  StocktakeScope,
  StocktakeStatus,
} from "@/lib/schemas/stocktakes";
import { parseStocktakeScope } from "@/lib/schemas/stocktakes";
import type { ItemType } from "@/app/(dashboard)/inventory/types";

export type StocktakeScopeOption = {
  value: StocktakeScope;
  label: string;
};

export type StocktakeScopeOptionGroup = {
  label: string;
  options: StocktakeScopeOption[];
};

export function formatScope(scope: StocktakeScope) {
  const parsed = parseStocktakeScope(scope);

  if (parsed.kind === "all") {
    return "All Items";
  }

  if (parsed.kind === "type") {
    return parsed.itemType === "material" ? "Materials" : "Products";
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

function formatStocktakeScopeTypeLabel(itemType: StocktakeScopeItemType) {
  return itemType === "material" ? "Materials" : "Products";
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
  unitName: string;
  expectedQty: string;
  countedQty: string | null;
  varianceQty: string | null;
  appliedDeltaQty: string | null;
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
  completedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lines: StocktakeDetailLine[];
};

export type StocktakeStaleWarningPayload = {
  items: Array<{
    lineId: string;
    itemId: string;
    itemName: string;
    unitName: string;
    expectedQty: string;
    currentQty: string;
    countedQty: string;
  }>;
};
