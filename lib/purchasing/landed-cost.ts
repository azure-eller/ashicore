import { normalizeNumeric, normalizeNumericScale } from "@/lib/format";
import { normalizeStockUnitCost } from "@/lib/inventory/cost";

export type LandedCostDistributionMethod = "by_value" | "not_distributed";

export type LandedCostLineInput = {
  quantityOrdered: string | number | null | undefined;
  unitCost: string | number | null | undefined;
  purchaseToStockFactor: string | number | null | undefined;
};

export type LandedCostAdditionalCostInput = {
  amount?: string | number | null | undefined;
  distributionMethod?: LandedCostDistributionMethod | string | null | undefined;
};

export type LandedCostLineResult = {
  lineSubtotal: number;
  allocatedAdditionalCost: number;
  landedLineTotal: number;
  stockQuantityOrdered: number;
  landedStockUnitCost: number | null;
};

export type LandedCostSummary = {
  materialSubtotal: number;
  additionalCostTotal: number;
  distributedAdditionalCostTotal: number;
  nonDistributedAdditionalCostTotal: number;
  orderTotal: number;
  lines: LandedCostLineResult[];
};

function parseFiniteNumber(value: string | number | null | undefined) {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNonNegativeNumber(value: string | number | null | undefined) {
  const parsed = parseFiniteNumber(value);
  return parsed != null && parsed >= 0 ? parsed : null;
}

function parsePositiveNumber(value: string | number | null | undefined) {
  const parsed = parseFiniteNumber(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

export function calculatePurchaseOrderLandedCosts(params: {
  lines: LandedCostLineInput[];
  additionalCosts?: LandedCostAdditionalCostInput[];
  legacyShippingCost?: string | number | null | undefined;
}): LandedCostSummary {
  const lineBases = params.lines.map((line) => {
    const quantityOrdered = parsePositiveNumber(line.quantityOrdered);
    const unitCost = parseNonNegativeNumber(line.unitCost);
    const purchaseToStockFactor = parsePositiveNumber(line.purchaseToStockFactor);
    const lineSubtotal =
      quantityOrdered == null || unitCost == null ? 0 : quantityOrdered * unitCost;
    const stockQuantityOrdered =
      quantityOrdered == null || purchaseToStockFactor == null
        ? 0
        : quantityOrdered * purchaseToStockFactor;

    return {
      lineSubtotal,
      stockQuantityOrdered,
    };
  });
  const materialSubtotal = lineBases.reduce(
    (sum, line) => sum + line.lineSubtotal,
    0
  );
  const additionalCosts = params.additionalCosts ?? [];
  const legacyShippingCost =
    additionalCosts.length === 0
      ? parseNonNegativeNumber(params.legacyShippingCost) ?? 0
      : 0;
  const additionalCostTotal = additionalCosts.reduce((sum, cost) => {
    return sum + (parseNonNegativeNumber(cost.amount) ?? 0);
  }, legacyShippingCost);
  const distributedAdditionalCostTotal = additionalCosts.reduce((sum, cost) => {
    if (cost.distributionMethod !== "by_value") return sum;
    return sum + (parseNonNegativeNumber(cost.amount) ?? 0);
  }, legacyShippingCost);

  const lines = lineBases.map((line) => {
    const allocatedAdditionalCost =
      materialSubtotal > 0 && distributedAdditionalCostTotal > 0
        ? (line.lineSubtotal / materialSubtotal) * distributedAdditionalCostTotal
        : 0;
    const landedLineTotal = line.lineSubtotal + allocatedAdditionalCost;
    const landedStockUnitCost =
      line.stockQuantityOrdered > 0
        ? landedLineTotal / line.stockQuantityOrdered
        : null;

    return {
      lineSubtotal: line.lineSubtotal,
      allocatedAdditionalCost,
      landedLineTotal,
      stockQuantityOrdered: line.stockQuantityOrdered,
      landedStockUnitCost,
    };
  });

  return {
    materialSubtotal,
    additionalCostTotal,
    distributedAdditionalCostTotal,
    nonDistributedAdditionalCostTotal:
      additionalCostTotal - distributedAdditionalCostTotal,
    orderTotal: materialSubtotal + additionalCostTotal,
    lines,
  };
}

export function normalizeLandedMoney(value: number) {
  return normalizeNumeric(value);
}

export function normalizeLandedStockUnitCost(value: number | null) {
  return value == null ? null : normalizeStockUnitCost(value);
}

export function normalizeLandedQuantity(value: number) {
  return normalizeNumeric(value);
}

export function normalizeLandedDisplayNumber(value: number) {
  return normalizeNumericScale(value, 6);
}
