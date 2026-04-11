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

export function getInitials(value: string | null | undefined): string {
  return (value ?? "")
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
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
 * Round a quantity to 4 decimal places to avoid JS float imprecision.
 */
export function roundQuantity(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Summarize a list of line items for display in table columns.
 * Shows up to 2 items with optional quantities, then "+ N more".
 * e.g. "50 Widget A, 20 Widget B + 1 more"
 */
export function summarizeItems(
  lines: Array<{ itemName: string; quantity?: string | null }>
): string {
  if (lines.length === 0) return "\u2014";

  const fmt = (line: { itemName: string; quantity?: string | null }) => {
    if (line.quantity != null) {
      const qty = parseFloat(line.quantity);
      if (!isNaN(qty)) return `${qty} ${line.itemName}`;
    }
    return line.itemName;
  };

  if (lines.length === 1) return fmt(lines[0]);

  const visible = [fmt(lines[0]), fmt(lines[1])].join(", ");
  if (lines.length === 2) return visible;
  return `${visible} + ${lines.length - 2} more`;
}

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  manual_adjustment: "Manual",
  purchase_received: "Purchase",
  manufacturing_consumed: "MO consumed",
  manufacturing_produced: "MO produced",
  sales_fulfilled: "Sale",
  stocktake_adjustment: "Stocktake",
};

export function formatMovementType(type: string | null): string {
  if (!type) return "\u2014";
  return MOVEMENT_TYPE_LABELS[type] ?? type;
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

/**
 * Build the canonical display name for a variant item.
 * For standalone items: returns the item name as-is.
 * For variants: returns "Master Name / Value1 / Value2" in axis order.
 *
 * @param masterName  The parent product family name (e.g. "Bomb")
 * @param attrs       The variant's attribute map (e.g. {"Package": "2 Cubic Foot Bag"})
 * @param axes        The master's axis order (e.g. ["Package"]) — values are shown in this order
 */
export function formatVariantDisplay(
  masterName: string,
  attrs: Record<string, string>,
  axes: string[],
): string {
  const values = axes.map((axis) => attrs[axis]).filter(Boolean);
  if (values.length === 0) return masterName;
  return `${masterName} / ${values.join(" / ")}`;
}
