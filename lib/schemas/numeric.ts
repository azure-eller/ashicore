import { z } from "zod";
import { normalizeMoney, normalizeNumeric } from "@/lib/format";

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
