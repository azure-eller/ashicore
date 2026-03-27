const priceFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/**
 * Format a price string as USD currency.
 * Returns null for null/undefined inputs.
 */
export function formatPrice(value: string | null | undefined): string | null {
  if (value == null) return null;
  return priceFormat.format(parseFloat(value));
}

export function formatDate(value: string | Date | null | undefined): string {
  if (value == null) return "\u2014";
  if (typeof value === "string") {
    // Date-only strings (YYYY-MM-DD) need T00:00:00 to avoid timezone shift.
    // Full ISO strings (from RSC serialization) are already parseable as-is.
    const d = value.includes("T") ? new Date(value) : new Date(`${value}T00:00:00`);
    return d.toLocaleDateString("en-US");
  }
  return new Date(value).toLocaleDateString("en-US");
}

export function formatDateTime(value: Date | null | undefined): string {
  if (value == null) return "\u2014";
  return new Date(value).toLocaleString("en-US");
}

/**
 * Format a Postgres numeric string for display.
 * Strips trailing zeros: "1.5000" → "1.5", "10.0000" → "10".
 * Returns "—" for null/undefined.
 */
export function formatQuantity(value: string | null | undefined): string {
  if (value == null) return "\u2014";
  return parseFloat(value).toString();
}

/**
 * Normalize a number for Postgres numeric storage.
 * Strips trailing zeros: 1.5 → "1.5", 10 → "10", 0 → "0".
 * Use for ALL numeric writes — quantities, costs, amounts, prices.
 */
export function normalizeNumeric(value: number): string {
  return value.toFixed(4).replace(/\.?0+$/, "");
}

/**
 * Normalize a money value for Postgres numeric storage (2 decimal places).
 */
export function normalizeMoney(value: number): string {
  return value.toFixed(2);
}

/**
 * Parse a string as a positive number for display math (line totals, order totals).
 * Returns null for empty, non-finite, or non-positive values.
 */
export function parsePositive(value: string | null | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Extract root-level error message from a react-hook-form field array error.
 */
export function getFieldArrayError(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  if ("message" in error && typeof error.message === "string") {
    return error.message;
  }
  return null;
}
