const priceFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/**
 * Format a price string as USD currency.
 * Returns null for null/undefined inputs.
 */
export function formatPrice(value: string | null | undefined): string | null {
  if (value == null) return null;
  return priceFormat.format(parseFloat(value));
}
