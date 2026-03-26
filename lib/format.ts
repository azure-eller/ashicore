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
    return new Date(`${value}T00:00:00`).toLocaleDateString("en-US");
  }
  return new Date(value).toLocaleDateString("en-US");
}

export function formatDateTime(value: Date | null | undefined): string {
  if (value == null) return "\u2014";
  return new Date(value).toLocaleString("en-US");
}
