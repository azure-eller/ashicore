import type { InventoryDisposition } from "@/lib/db/schema";

const priceFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const costFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

/**
 * Format a price string as USD currency.
 * Returns null for null/undefined inputs.
 */
export function formatPrice(value: string | null | undefined): string | null {
  if (value == null) return null;
  return priceFormat.format(parseFloat(value));
}

export function formatCost(value: string | null | undefined): string | null {
  if (value == null) return null;
  return costFormat.format(parseFloat(value));
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

type UnitDisplayInput = {
  name?: string | null;
  size?: string | null;
  uom?: string | null;
};

const UOM_DISPLAY_LABELS: Record<string, string> = {
  "cu ft": "cf",
  ft3: "cf",
  "ft³": "cf",
  "cu yd": "yd",
  yd3: "yd",
  "yd³": "yd",
  l: "L",
  liter: "L",
  litre: "L",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
  tbsp: "Tbs",
  tbs: "Tbs",
  tablespoon: "Tbs",
  tablespoons: "Tbs",
  c: "cup",
  cups: "cup",
};

function compactUomLabel(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  return UOM_DISPLAY_LABELS[trimmed.toLowerCase()] ?? trimmed;
}

function normalizeCompactUnitName(value: string) {
  return value
    .replace(/\bcubic\s+feet\b/gi, "cf")
    .replace(/\bcubic\s+foot\b/gi, "cf")
    .replace(/\bcubic\s+yards\b/gi, "yd")
    .replace(/\bcubic\s+yard\b/gi, "yd")
    .replace(/\byards?\b/gi, "yd")
    .replace(/\bkilograms?\b/gi, "kg")
    .replace(/\bpounds?\b/gi, "lb")
    .replace(/\bgallons?\b/gi, "gal")
    .replace(/\blit(er|re)s?\b/gi, "L")
    .replace(/\btablespoons?\b/gi, "Tbs")
    .replace(/\bteaspoons?\b/gi, "tsp")
    .replace(/\bcups?\b/gi, "cup")
    .replace(/\bbags?\b/gi, "bag")
    .replace(/\bbales?\b/gi, "bale")
    .replace(/\btotes?\b/gi, "tote")
    .replace(/\bpallets?\b/gi, "pallet")
    .replace(/\brolls?\b/gi, "roll")
    .replace(/\bpacks?\b/gi, "pack")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compact a unit definition for dense table cells.
 *
 * The stored `uom` already comes from the conversion library's symbol list.
 * This helper only shortens common freeform package names around that symbol,
 * e.g. "4 Cubic Foot Bale" -> "4 cf bale".
 */
export function formatCompactUnitLabel(unit: UnitDisplayInput): string | null {
  const name = unit.name?.trim();
  const compactName = name ? normalizeCompactUnitName(name) : null;

  if (compactName && compactName.length < name!.length) {
    return compactName;
  }

  const uom = compactUomLabel(unit.uom);
  const size = unit.size ? formatQuantity(unit.size) : null;
  if (uom && size && size !== "1") return `${size} ${uom}`;
  if (uom) return uom;
  return compactName;
}

export function normalizeNumericScale(value: number, scale: number): string {
  return value.toFixed(scale).replace(/\.?0+$/, "");
}

/**
 * Normalize a number for Postgres numeric storage.
 * Strips trailing zeros: 1.5 → "1.5", 10 → "10", 0 → "0".
 * Use for ALL numeric writes — quantities, costs, amounts, prices.
 */
export function normalizeNumeric(value: number): string {
  return normalizeNumericScale(value, 4);
}

/**
 * Normalize a money value for Postgres numeric storage (2 decimal places).
 */
export function normalizeMoney(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, "");
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
export type AddressLike = {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  region?: string | null;
  postcode?: string | null;
  country?: string | null;
};

/**
 * Format a structured address into lines suitable for <pre>/whitespace-pre-wrap display.
 * Returns null if every field is blank.
 */
export function formatAddressLines(address: AddressLike): string[] {
  const lines: string[] = [];

  if (address.line1?.trim()) lines.push(address.line1.trim());
  if (address.line2?.trim()) lines.push(address.line2.trim());

  const cityLine = [address.city, address.region, address.postcode]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(", ");
  if (cityLine) lines.push(cityLine);

  if (address.country?.trim()) lines.push(address.country.trim());

  return lines;
}

export function formatAddress(address: AddressLike): string {
  return formatAddressLines(address).join("\n");
}

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
  manufacturing_picked: "MO picked",
  manufacturing_consumed: "MO consumed",
  manufacturing_produced: "MO produced",
  manufacturing_variance: "MO variance",
  sales_shipped: "Sale",
  stocktake_adjustment: "Stocktake",
  quality_disposition: "Disposition",
  quality_scrap: "Scrap",
};

export function formatMovementType(type: string | null): string {
  if (!type) return "\u2014";
  return MOVEMENT_TYPE_LABELS[type] ?? type;
}

const INVENTORY_DISPOSITION_LABELS: Record<InventoryDisposition, string> = {
  available: "Available",
  blocked: "Blocked",
  rejected: "Rejected",
};

export function formatInventoryDisposition(disposition: InventoryDisposition) {
  return INVENTORY_DISPOSITION_LABELS[disposition];
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

/**
 * Resolve the structured display pieces for an item line.
 *
 *  - For a variant (parent present + variantAttrs): returns the master name
 *    and the attribute values in axis order, ready to render as a label
 *    with badge/pill secondary fields.
 *  - For a standalone item or master: returns the item's own name with an
 *    empty `attrs` list.
 *
 * This keeps the " / " concatenation convention confined to
 * `formatVariantDisplay` — callers that want structured output should use
 * this helper instead of splitting the concatenated string.
 */
export function resolveVariantDisplay(
  itemName: string,
  master: { name: string | null; variantAxes: string[] | null } | null,
  variantAttrs: Record<string, string> | null,
): { masterName: string; attrs: string[] } {
  if (master?.name && master.variantAxes && variantAttrs) {
    const attrs = master.variantAxes
      .map((axis) => variantAttrs[axis])
      .filter((v): v is string => Boolean(v));
    return { masterName: master.name, attrs };
  }
  return { masterName: itemName, attrs: [] };
}
