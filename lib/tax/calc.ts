import { normalizeMoney } from "@/lib/format";
import { isNonNegativeNumberString } from "@/lib/schemas/shared";

export function normalizeTaxPercent(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  if (!isNonNegativeNumberString(String(value ?? 0))) return "0";
  return parsed.toString();
}

export function calculateTaxAmount(
  subtotal: number,
  ratePercent: string | number | null | undefined,
  scale: 2 | 4 = 2,
) {
  const rate = Number(ratePercent ?? 0);
  const tax = Number.isFinite(rate) ? subtotal * (rate / 100) : 0;
  return scale === 2 ? normalizeMoney(tax) : tax.toFixed(4);
}

export function calculateTaxedLineTotal(
  subtotal: number,
  taxAmount: string,
  scale: 2 | 4 = 2,
) {
  const total = subtotal + Number(taxAmount || 0);
  return scale === 2 ? normalizeMoney(total) : total.toFixed(4);
}
