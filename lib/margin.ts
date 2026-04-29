import { normalizeMoney, normalizeNumericScale } from "@/lib/format";

export type MarginMetrics = {
  revenue: string;
  cogs: string;
  grossProfit: string;
  marginPercent: string | null;
};

function parseFinite(value: string | number | null | undefined): number | null {
  if (value == null) {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function calculateMarginMetrics(params: {
  revenue: string | number | null | undefined;
  cogs: string | number | null | undefined;
}): MarginMetrics | null {
  const revenue = parseFinite(params.revenue);
  const cogs = parseFinite(params.cogs);

  if (revenue == null || cogs == null) {
    return null;
  }

  const grossProfit = revenue - cogs;

  return {
    revenue: normalizeMoney(revenue),
    cogs: normalizeMoney(cogs),
    grossProfit: normalizeMoney(grossProfit),
    marginPercent:
      revenue > 0
        ? normalizeNumericScale((grossProfit / revenue) * 100, 1)
        : null,
  };
}

export function calculateUnitMarginMetrics(params: {
  quantity: string | number | null | undefined;
  unitPrice: string | number | null | undefined;
  unitCost: string | number | null | undefined;
}) {
  const quantity = parseFinite(params.quantity);
  const unitPrice = parseFinite(params.unitPrice);
  const unitCost = parseFinite(params.unitCost);

  if (quantity == null || unitPrice == null || unitCost == null) {
    return null;
  }

  return calculateMarginMetrics({
    revenue: quantity * unitPrice,
    cogs: quantity * unitCost,
  });
}
