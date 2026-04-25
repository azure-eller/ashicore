import { z } from "zod";

/**
 * Accepts string | null | undefined, normalizes to string | null.
 * Trims whitespace; empty strings become null.
 * Use for all optional text fields in standalone Zod schemas (sales, manufacturing, customers).
 */
export const nullableString = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v != null ? v.trim() || null : null));

/**
 * Same normalization as nullableString but without .optional().
 * Use inside createInsertSchema overrides where Drizzle handles optionality.
 */
export const nullableStringStrict = z
  .string()
  .nullable()
  .transform((v) => (v != null ? v.trim() || null : null));

/**
 * Validates that a string is a real ISO date (YYYY-MM-DD) that exists
 * on the calendar (rejects Feb 30, etc.).
 */
export function isValidIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1
  ) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * Zod string that must be a positive decimal number.
 * Use for quantity / price fields that arrive as strings from forms.
 */
/**
 * Shared schema for bulk delete endpoints.
 * All DELETE routes accept { ids: string[] }.
 */
export const bulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

export const positiveDecimalString = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .refine((value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0;
    }, `${label} must be greater than 0`);

/**
 * Default values for the six structured address columns. Reuse in form
 * defaultValues so every field has an explicit null instead of undefined.
 */
export const addressDefaultValues = {
  line1: null,
  line2: null,
  city: null,
  region: null,
  postcode: null,
  country: null,
} as const;

export type StructuredAddress = {
  line1: string | null;
  line2: string | null;
  city: string | null;
  region: string | null;
  postcode: string | null;
  country: string | null;
};
