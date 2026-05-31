import { normalizeMoney } from "@/lib/format";
import {
  calculateTaxAmount,
  calculateTaxedLineTotal,
} from "@/lib/tax/calc";

export type SalesLineAmountInput = {
  quantity: string | number | null | undefined;
  unitPrice: string | number | null | undefined;
  taxRatePercent: string | number | null | undefined;
};

export function calculateSalesLineAmounts(input: SalesLineAmountInput) {
  const subtotal =
    Number(input.quantity || 0) * Number(input.unitPrice || 0);
  const lineTaxAmount = calculateTaxAmount(
    subtotal,
    input.taxRatePercent,
    2,
  );

  return {
    lineSubtotal: normalizeMoney(subtotal),
    lineTaxAmount,
    lineTotal: calculateTaxedLineTotal(subtotal, lineTaxAmount, 2),
  };
}

export function calculateSalesLineTotalForQuantity(
  line: Pick<SalesLineAmountInput, "unitPrice" | "taxRatePercent"> | undefined,
  quantity: string | number | null | undefined,
) {
  if (!line) return "0.00";
  return calculateSalesLineAmounts({
    quantity,
    unitPrice: line.unitPrice,
    taxRatePercent: line.taxRatePercent,
  }).lineTotal;
}

export function calculateDiscountPercentValue(
  listUnitPrice: string | number | null | undefined,
  unitPrice: string | number | null | undefined,
) {
  const list = listUnitPrice == null ? NaN : Number(listUnitPrice);
  const unit = unitPrice == null ? NaN : Number(unitPrice);
  if (!Number.isFinite(list) || !Number.isFinite(unit) || list <= 0) {
    return null;
  }
  if (unit >= list) {
    return 0;
  }
  return ((list - unit) / list) * 100;
}

export function calculateDiscountPercentString(
  listUnitPrice: string | number | null | undefined,
  unitPrice: string | number | null | undefined,
) {
  return normalizeMoney(calculateDiscountPercentValue(listUnitPrice, unitPrice) ?? 0);
}
