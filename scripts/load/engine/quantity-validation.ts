import {
  isNumeric12Scale4Representable,
  nonNegativeQuantityString,
  normalizeNumeric12Scale4,
  positiveQuantityString,
  roundsToPositiveNumeric12Scale4,
} from "@/lib/schemas/shared";

function firstIssueMessage(result: { error: { issues: Array<{ message: string }> } }) {
  return result.error.issues[0]?.message ?? "Quantity is invalid";
}

export function requireLoaderPositiveQuantity(
  value: string | number,
  context: string,
) {
  const result = positiveQuantityString("Quantity").safeParse(String(value));
  if (!result.success) {
    throw new Error(`${context}: ${firstIssueMessage(result)}. Enter a quantity from 0.0001 to 99,999,999.9999 using no more than 4 decimal places.`);
  }
  return result.data;
}

export function requireLoaderNonNegativeQuantity(
  value: string | number,
  context: string,
) {
  const result = nonNegativeQuantityString("Quantity").safeParse(String(value));
  if (!result.success) {
    throw new Error(`${context}: ${firstIssueMessage(result)}. Enter 0 or a quantity from 0.0001 to 99,999,999.9999 using no more than 4 decimal places.`);
  }
  return result.data;
}

/**
 * Derived conversions may be rounded to the database scale, but a positive
 * source value must never silently become zero or overflow numeric(12,4).
 */
export function requireLoaderDerivedPositiveQuantity(
  value: string | number,
  context: string,
) {
  const numericValue = Number(value);
  if (
    !Number.isFinite(numericValue) ||
    numericValue <= 0 ||
    !roundsToPositiveNumeric12Scale4(value) ||
    !isNumeric12Scale4Representable(value)
  ) {
    throw new Error(
      `${context}: the converted stock quantity must round to a value from 0.0001 to 99,999,999.9999. Enter a larger quantity or use a smaller stocking unit.`,
    );
  }
  return normalizeNumeric12Scale4(value);
}
