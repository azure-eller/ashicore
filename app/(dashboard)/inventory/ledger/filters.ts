import { inventoryLedgerFiltersSchema, type InventoryLedgerFilters } from "@/lib/schemas/inventory-ledger";
import { firstSearchParamValue, type SearchParamRecord } from "@/lib/routing/search-params";

export function parseInventoryLedgerFilters(
  source: URLSearchParams | SearchParamRecord
): InventoryLedgerFilters {
  const raw =
    source instanceof URLSearchParams
      ? Object.fromEntries(source.entries())
      : Object.fromEntries(
          Object.entries(source).map(([key, value]) => [key, firstSearchParamValue(value)])
        );

  return inventoryLedgerFiltersSchema.parse(raw);
}

export function buildInventoryLedgerSearchParams(filters: InventoryLedgerFilters) {
  const searchParams = new URLSearchParams();

  const entries = Object.entries(filters).filter(([key, value]) => {
    if (value == null) return false;
    if (key === "timeZone" && !filters.dateFrom && !filters.dateTo) return false;
    if (key === "eventClasses") {
      return Array.isArray(value) && !(value.length === 1 && value[0] === "stock");
    }
    if (typeof value === "string") return value.length > 0;
    if (typeof value === "number") {
      if (key === "page") return value !== 1;
      if (key === "pageSize") return value !== 50;
      return true;
    }

    return true;
  });

  for (const [key, value] of entries) {
    if (typeof value === "number") {
      searchParams.set(key, String(value));
    } else if (Array.isArray(value)) {
      searchParams.set(key, value.join(","));
    } else if (value != null) {
      searchParams.set(key, value);
    }
  }

  return searchParams;
}
