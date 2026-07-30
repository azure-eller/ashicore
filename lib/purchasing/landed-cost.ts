import {
  normalizeNumeric,
  normalizeNumericScale,
  parseNonNegativeNumber,
  parsePositiveNumber,
} from "@/lib/format";
import { normalizeStockUnitCost } from "@/lib/inventory/cost";
import type { PurchaseOrderAdditionalCostDistributionMethod } from "@/lib/schemas/purchase-orders";

export type LandedCostDistributionMethod =
  PurchaseOrderAdditionalCostDistributionMethod;

export type LandedCostLineInput = {
  quantityOrdered: string | number | null | undefined;
  unitCost: string | number | null | undefined;
  purchaseToStockFactor: string | number | null | undefined;
};

export type LandedCostAdditionalCostInput = {
  amount?: string | number | null | undefined;
  distributionMethod?: LandedCostDistributionMethod | string | null | undefined;
};

export type LandedCostAllocationBasis =
  | "by_value"
  | "by_quantity"
  | "mixed";

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

export function calculatePurchaseOrderLandedCosts(params: {
  lines: LandedCostLineInput[];
  additionalCosts?: LandedCostAdditionalCostInput[];
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
      quantityOrdered: quantityOrdered ?? 0,
      lineSubtotal,
      stockQuantityOrdered,
    };
  });
  const purchaseQuantityTotal = lineBases.reduce(
    (sum, line) => sum + line.quantityOrdered,
    0,
  );
  const materialSubtotal = lineBases.reduce(
    (sum, line) => sum + line.lineSubtotal,
    0,
  );
  const additionalCosts = params.additionalCosts ?? [];
  const additionalCostTotal = additionalCosts.reduce((sum, cost) => {
    return sum + (parseNonNegativeNumber(cost.amount) ?? 0);
  }, 0);
  const byValueAdditionalCostTotal = additionalCosts.reduce((sum, cost) => {
    if (cost.distributionMethod !== "by_value") return sum;
    return sum + (parseNonNegativeNumber(cost.amount) ?? 0);
  }, 0);
  const byQuantityAdditionalCostTotal = additionalCosts.reduce((sum, cost) => {
    if (cost.distributionMethod !== "by_quantity") return sum;
    return sum + (parseNonNegativeNumber(cost.amount) ?? 0);
  }, 0);
  const distributedAdditionalCostTotal =
    byValueAdditionalCostTotal + byQuantityAdditionalCostTotal;

  const lines = lineBases.map((line) => {
    const valueAllocation =
      materialSubtotal > 0 && byValueAdditionalCostTotal > 0
        ? (line.lineSubtotal / materialSubtotal) * byValueAdditionalCostTotal
        : 0;
    const quantityAllocation =
      purchaseQuantityTotal > 0 && byQuantityAdditionalCostTotal > 0
        ? (line.quantityOrdered / purchaseQuantityTotal) *
          byQuantityAdditionalCostTotal
        : 0;
    const allocatedAdditionalCost = valueAllocation + quantityAllocation;
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

export function resolveLandedCostAllocationBasis(
  additionalCosts: LandedCostAdditionalCostInput[],
): LandedCostAllocationBasis | undefined {
  let hasByValue = false;
  let hasByQuantity = false;

  for (const cost of additionalCosts) {
    if ((parseNonNegativeNumber(cost.amount) ?? 0) <= 0) continue;
    if (cost.distributionMethod === "by_value") hasByValue = true;
    if (cost.distributionMethod === "by_quantity") hasByQuantity = true;
  }

  if (hasByValue && hasByQuantity) return "mixed";
  if (hasByQuantity) return "by_quantity";
  if (hasByValue) return "by_value";
  return undefined;
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
