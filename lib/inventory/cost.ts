import { normalizeNumericScale } from "@/lib/format";

export function resolveStockUnitCostFromDefaultPurchasePrice(params: {
  defaultPurchasePrice: string | null;
  purchaseToStockFactor: string | null;
}) {
  if (params.defaultPurchasePrice == null) {
    return null;
  }

  const purchaseUnitCost = parseFloat(params.defaultPurchasePrice);
  if (!Number.isFinite(purchaseUnitCost)) {
    return null;
  }

  const factor = parseFloat(params.purchaseToStockFactor ?? "1");
  if (!Number.isFinite(factor) || factor <= 0) {
    return null;
  }

  return normalizeNumericScale(purchaseUnitCost / factor, 6);
}
