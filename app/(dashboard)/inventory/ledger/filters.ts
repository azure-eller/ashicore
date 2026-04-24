import { inventoryLedgerFiltersSchema, type InventoryLedgerFilters } from "@/lib/schemas/inventory-ledger";

type SearchParamRecord = Record<string, string | string[] | undefined>;

function normalizeValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function parseInventoryLedgerFilters(
  source: URLSearchParams | SearchParamRecord
): InventoryLedgerFilters {
  const raw =
    source instanceof URLSearchParams
      ? Object.fromEntries(source.entries())
      : Object.fromEntries(
          Object.entries(source).map(([key, value]) => [key, normalizeValue(value)])
        );

  return inventoryLedgerFiltersSchema.parse(raw);
}

export function buildInventoryLedgerSearchParams(filters: InventoryLedgerFilters) {
  const searchParams = new URLSearchParams();

  const entries = Object.entries(filters).filter(([key, value]) => {
    if (value == null) return false;
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
    } else if (value != null) {
      searchParams.set(key, value);
    }
  }

  return searchParams;
}
