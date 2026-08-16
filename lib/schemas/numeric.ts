import { z } from "zod";
import Decimal from "decimal.js-light";
import { normalizeMoney, normalizeNumeric } from "@/lib/format";

const NUMERIC_12_4_MAX = new Decimal("99999999.9999");
const NUMERIC_12_4_MIN_POSITIVE = new Decimal("0.0001");

export const QUANTITY_SCALE = 4;
export const MIN_POSITIVE_QUANTITY = "0.0001";

export function isNumeric12Scale4Representable(value: string | number) {
  try {
    return new Decimal(value)
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
      .abs()
      .lte(NUMERIC_12_4_MAX);
  } catch {
    return false;
  }
}

export function roundsToPositiveNumeric12Scale4(value: string | number) {
  try {
    return new Decimal(value)
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
      .gt(0);
  } catch {
    return false;
  }
}

export function isAtLeastNumeric12Scale4Minimum(value: string | number) {
  try {
    return new Decimal(value).gte(NUMERIC_12_4_MIN_POSITIVE);
  } catch {
    return false;
  }
}

export function hasAtMostNumeric12Scale4(value: string | number) {
  try {
    return new Decimal(value).decimalPlaces() <= QUANTITY_SCALE;
  } catch {
    return false;
  }
}

function isExactlyZero(value: string | number) {
  try {
    return new Decimal(value).isZero();
  } catch {
    return false;
  }
}

export function normalizeNumeric12Scale4(value: string | number) {
  const normalized = new Decimal(value)
    .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
    .toFixed(4)
    .replace(/\.?0+$/, "");
  return normalized === "-0" ? "0" : normalized;
}

export const positiveQuantityString = (label = "Quantity") =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .refine(isPositiveNumberString, `${label} must be greater than 0`)
    .refine(
      isAtLeastNumeric12Scale4Minimum,
      `${label} must be at least ${MIN_POSITIVE_QUANTITY}`,
    )
    .refine(
      (value) =>
        !isPositiveNumberString(value) ||
        !isAtLeastNumeric12Scale4Minimum(value) ||
        hasAtMostNumeric12Scale4(value),
      `${label} supports up to ${QUANTITY_SCALE} decimal places`,
    )
    .refine(
      (value) =>
        !isPositiveNumberString(value) ||
        isNumeric12Scale4Representable(value),
      `${label} must be 99,999,999.9999 or less`,
    )
    .transform(normalizeNumeric12Scale4);

export const nonNegativeQuantityString = (label = "Quantity") =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .refine(isNonNegativeNumberString, `${label} must be 0 or greater`)
    .refine(
      (value) => isExactlyZero(value) || isAtLeastNumeric12Scale4Minimum(value),
      `${label} must be 0 or at least ${MIN_POSITIVE_QUANTITY}`,
    )
    .refine(
      (value) =>
        !isNonNegativeNumberString(value) ||
        (!isExactlyZero(value) && !isAtLeastNumeric12Scale4Minimum(value)) ||
        hasAtMostNumeric12Scale4(value),
      `${label} supports up to ${QUANTITY_SCALE} decimal places`,
    )
    .refine(
      (value) =>
        !isNonNegativeNumberString(value) ||
        isNumeric12Scale4Representable(value),
      `${label} must be 99,999,999.9999 or less`,
    )
    .transform(normalizeNumeric12Scale4);

/**
 * Same normalization as nullableString but preserves undefined as undefined.
 * Use in partial-update (PUT/PATCH) schemas that merge only the fields sent, so
 * omitted fields are skipped on update instead of being wiped to null; an
 * explicit empty string still clears the value.
 */
export const nullableStringPreserveUndefined = z
  .string()
  .nullable()
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined;
    }

    return value != null ? value.trim() || null : null;
  });

export function isNonNegativeNumberString(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0;
}

export function isPositiveNumberString(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

export const positiveDecimalString = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .refine(isPositiveNumberString, `${label} must be greater than 0`);

export const nonNegativeDecimalString = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .refine((value) => isNonNegativeNumberString(value), `${label} must be 0 or greater`)
    .transform((value) => normalizeNumeric(Number(value)));

export const optionalNonNegativeDecimalString = (label: string) =>
  z
    .string()
    .nullable()
    .optional()
    .transform((value) => (value != null ? value.trim() || null : null))
    .refine(
      (value) => value == null || isNonNegativeNumberString(value),
      `${label} must be 0 or greater`
    )
    .transform((value) => (value == null ? null : normalizeNumeric(Number(value))));

export const optionalNonNegativeDecimalInputPreserveUndefined = (label: string) =>
  nullableStringPreserveUndefined.refine(
    (value) => value == null || isNonNegativeNumberString(value),
    `${label} must be a non-negative number`,
  );

export const optionalPositiveDecimalString = (label: string) =>
  optionalNonNegativeDecimalString(label).refine(
    (value) => value == null || Number(value) > 0,
    `${label} must be greater than 0`,
  );

export const optionalPositiveDecimalStringPreserveUndefined = (label: string) =>
  nullableStringPreserveUndefined
    .refine(
      (value) => value == null || isPositiveNumberString(value),
      `${label} must be greater than 0`,
    )
    .transform((value) =>
      value == null ? value : normalizeNumeric(Number(value)),
    );

export const optionalPositiveNumeric12Scale4String = (label: string) =>
  z
    .string()
    .nullable()
    .optional()
    .transform((value) => (value != null ? value.trim() || null : null))
    .refine(
      (value) => value == null || isPositiveNumberString(value),
      `${label} must be greater than 0`,
    )
    .refine(
      (value) => value == null || isAtLeastNumeric12Scale4Minimum(value),
      `${label} must be at least 0.0001`,
    )
    .refine(
      (value) =>
        value == null ||
        !isAtLeastNumeric12Scale4Minimum(value) ||
        hasAtMostNumeric12Scale4(value),
      `${label} supports up to 4 decimal places`,
    )
    .refine(
      (value) => value == null || isNumeric12Scale4Representable(value),
      `${label} must be 99,999,999.9999 or less`,
    )
    .transform((value) =>
      value == null ? null : normalizeNumeric12Scale4(value),
    );

export const optionalPositiveNumeric12Scale4StringPreserveUndefined = (
  label: string,
) =>
  nullableStringPreserveUndefined
    .refine(
      (value) => value == null || isPositiveNumberString(value),
      `${label} must be greater than 0`,
    )
    .refine(
      (value) => value == null || isAtLeastNumeric12Scale4Minimum(value),
      `${label} must be at least 0.0001`,
    )
    .refine(
      (value) =>
        value == null ||
        !isAtLeastNumeric12Scale4Minimum(value) ||
        hasAtMostNumeric12Scale4(value),
      `${label} supports up to 4 decimal places`,
    )
    .refine(
      (value) => value == null || isNumeric12Scale4Representable(value),
      `${label} must be 99,999,999.9999 or less`,
    )
    .transform((value) =>
      value == null ? value : normalizeNumeric12Scale4(value),
    );

export const optionalMoneyString = (label = "Amount") =>
  z
    .string()
    .nullable()
    .optional()
    .transform((value) => (value != null ? value.trim() || null : null))
    .refine(
      (value) => value == null || isNonNegativeNumberString(value),
      `${label} must be a non-negative number`
    )
    .transform((value) => (value == null ? null : normalizeMoney(Number(value))));

export const positiveMoneyString = (label = "Amount") =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .refine(isPositiveNumberString, `${label} must be greater than 0`)
    .transform((value) => normalizeMoney(Number(value)));
