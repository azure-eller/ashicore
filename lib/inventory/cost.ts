import { normalizeNumericScale } from "@/lib/format";

export function normalizeStockUnitCost(value: number) {
  return normalizeNumericScale(value, 6);
}

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

  return normalizeStockUnitCost(purchaseUnitCost / factor);
}

export function calculateNextCurrentStockUnitCost(params: {
  priorQuantity: number;
  priorUnitCost: string | null;
  incomingQuantity: number;
  incomingExtendedCost: number;
}) {
  if (params.incomingQuantity <= 0) {
    return null;
  }

  const incomingUnitCost = normalizeStockUnitCost(
    params.incomingExtendedCost / params.incomingQuantity
  );

  const priorUnitCost = params.priorUnitCost != null
    ? Number.parseFloat(params.priorUnitCost)
    : Number.NaN;

  if (params.priorQuantity <= 0 || !Number.isFinite(priorUnitCost)) {
    return incomingUnitCost;
  }

  return normalizeStockUnitCost(
    ((params.priorQuantity * priorUnitCost) + params.incomingExtendedCost) /
      (params.priorQuantity + params.incomingQuantity)
  );
}
