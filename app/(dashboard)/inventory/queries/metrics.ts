import { normalizeNumericScale } from "@/lib/format";
import type { ItemRow } from "../types";

export function parseNumeric(value: string | null | undefined): number {
  if (value == null) {
    return 0;
  }

  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function formatAggregateNumber(value: number): string {
  return value.toFixed(4).replace(/\.?0+$/, "");
}

export function calculateMarginPercent(
  defaultSellingPrice: string | null | undefined,
  estimatedUnitCost: string | null | undefined,
) {
  if (defaultSellingPrice == null || estimatedUnitCost == null) {
    return null;
  }

  const sellingPrice = Number.parseFloat(defaultSellingPrice);
  const cost = Number.parseFloat(estimatedUnitCost);

  if (!Number.isFinite(sellingPrice) || sellingPrice <= 0 || !Number.isFinite(cost)) {
    return null;
  }

  return normalizeNumericScale(((sellingPrice - cost) / sellingPrice) * 100, 1);
}

export function formatAverageMargin(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return normalizeNumericScale(average, 1);
}

export function applyMarginTiers(rows: ItemRow[]) {
  const allRows = rows.flatMap((row) => [row, ...(row.subRows ?? [])]);
  const marginValues = allRows
    .map((row) => row.marginPercent)
    .filter((value): value is string => value != null)
    .map((value) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value));
  const nonNegativeMargins = marginValues
    .filter((value) => value >= 0)
    .sort((a, b) => a - b);
  const hasRelativeBands = nonNegativeMargins.length >= 3;
  const lowCutoff = hasRelativeBands
    ? nonNegativeMargins[Math.floor((nonNegativeMargins.length - 1) / 3)]
    : 20;
  const highCutoff = hasRelativeBands
    ? nonNegativeMargins[Math.ceil(((nonNegativeMargins.length - 1) * 2) / 3)]
    : 40;

  return rows.map((row) => applyMarginTier(row, lowCutoff, highCutoff));
}

function applyMarginTier(
  row: ItemRow,
  lowCutoff: number,
  highCutoff: number,
): ItemRow {
  const margin = row.marginPercent != null ? Number.parseFloat(row.marginPercent) : Number.NaN;
  const marginTier = !Number.isFinite(margin)
    ? null
    : margin < 0
      ? "negative"
      : margin <= lowCutoff
        ? "low"
        : margin >= highCutoff
          ? "high"
          : "mid";

  return {
    ...row,
    marginTier,
    subRows: row.subRows?.map((subRow) => applyMarginTier(subRow, lowCutoff, highCutoff)),
  };
}

export function formatPriceRange(values: Array<string | null | undefined>) {
  const prices = values
    .map((value) => (value != null ? Number.parseFloat(value) : Number.NaN))
    .filter((value) => !Number.isNaN(value));

  if (prices.length === 0) {
    return null;
  }

  const min = Math.min(...prices);
  const max = Math.max(...prices);

  return min === max ? `$${min}` : `$${min} \u2013 $${max}`;
}
