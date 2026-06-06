import type {
  StocktakeScope,
  StocktakeCreationMode,
  StocktakeScopeItemType,
} from "@/lib/schemas/stocktakes";
import { parseStocktakeScope } from "@/lib/schemas/stocktakes";
import type { CloneStocktakeResult } from "@/lib/dal/stocktake-types";

export type {
  CloneStocktakeResult,
  ItemType,
  StocktakeCompletionPreview,
  StocktakeDetail,
  StocktakeDetailLine,
  StocktakeDetailLotLine,
  StocktakeListRow,
  StocktakePreviewItem,
  StocktakeScopeOption,
  StocktakeScopeOptionGroup,
  StocktakeStaleWarningPayload,
} from "@/lib/dal/stocktake-types";

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
