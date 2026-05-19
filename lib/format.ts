import {
  DEFAULT_COUNTRY,
  normalizeCountry,
  normalizeRegion,
} from "@/lib/address-options";
import type { InventoryDisposition } from "@/lib/db/schema";
import { isValidTimeZone } from "@/lib/time-zone";

const priceFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const costFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
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

/**
 * Formats a business date string, e.g. "2026-05-10".
 *
 * Do not pass timestamps. This does not use JS Date and does not
 * timezone-convert.
 */
export function formatDate(value: string | null | undefined): string {
  if (value == null) return "\u2014";

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return value;
  }

  return `${Number(match[2])}/${Number(match[3])}/${match[1]}`;
}

/**
 * Formats an exact instant, e.g. createdAt/shippedAt/occurredAt.
 *
 * Requires an explicit IANA timezone. Use organizationTimeZone for
 * operational ERP timestamps. Do not pass date-only strings.
 */
export function formatDateTime(
  value: string | Date | null | undefined,
  timeZone: string
): string {
  if (value == null) return "\u2014";
  if (!isValidTimeZone(timeZone)) {
    throw new Error(`Invalid IANA timezone: ${timeZone}`);
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("formatDateTime received a date-only string.");
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function todayInTimeZone(timeZone: string): string {
  if (!isValidTimeZone(timeZone)) {
    throw new Error(`Invalid IANA timezone: ${timeZone}`);
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error(`Unable to format today's date for timezone: ${timeZone}`);
  }

  return `${year}-${month}-${day}`;
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

export type AddressLike = {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  region?: string | null;
  postcode?: string | null;
  country?: string | null;
};

const STREET_SUFFIX_PATTERN =
  /\b(aly|alley|ave|avenue|blvd|boulevard|cir|circle|ct|court|dr|drive|hwy|highway|ln|lane|pkwy|parkway|pl|place|rd|road|st|street|ter|terrace|trl|trail|way)\b\.?/gi;

function splitStreetAndCity(value: string): { street: string; city: string } | null {
  const commaParts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (commaParts.length >= 2) {
    return {
      street: commaParts.slice(0, -1).join(", "),
      city: commaParts[commaParts.length - 1],
    };
  }

  const matches = [...value.matchAll(STREET_SUFFIX_PATTERN)];
  const suffix = matches.at(-1);
  if (suffix?.index == null) return null;

  const streetEnd = suffix.index + suffix[0].length;
  const street = value.slice(0, streetEnd).trim();
  const city = value.slice(streetEnd).trim();
  if (!street || !city || /\battn\b/i.test(city)) return null;

  return { street, city };
}

function splitOneLineUsAddress(value: string): AddressLike | null {
  const normalized = value.replace(/\s+/g, " ").replace(/\b([A-Z]{2})\./g, "$1").trim();
  const match = normalized.match(
    /^(.+?)\s*,?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/
  );
  if (!match) return null;
  const [, streetAndCity, region, postcode] = match;

  const split = splitStreetAndCity(streetAndCity);
  if (!split) return null;

  return {
    line1: split.street,
    city: split.city,
    region,
    postcode,
    country: DEFAULT_COUNTRY,
  };
}

export function normalizeAddressFields(address: AddressLike): Required<AddressLike> {
  const normalizedCountry = normalizeCountry(address.country);
  const normalized: AddressLike = {
    line1: address.line1?.trim() || null,
    line2: address.line2?.trim() || null,
    city: address.city?.trim() || null,
    region: normalizeRegion(normalizedCountry, address.region),
    postcode: address.postcode?.trim() || null,
    country: normalizedCountry,
  };

  if (
    normalized.line1 &&
    !normalized.line2 &&
    !normalized.city &&
    !normalized.region &&
    !normalized.postcode
  ) {
    const splitAddress = splitOneLineUsAddress(normalized.line1);
    if (!splitAddress) {
      return normalized as Required<AddressLike>;
    }

    return {
      ...normalized,
      ...splitAddress,
      country: normalized.country ?? splitAddress.country ?? DEFAULT_COUNTRY,
    } as Required<AddressLike>;
  }

  return normalized as Required<AddressLike>;
}

/**
 * Format a structured address into lines suitable for <pre>/whitespace-pre-wrap display.
 * Returns null if every field is blank.
 */
export function formatAddressLines(address: AddressLike): string[] {
  address = normalizeAddressFields(address);
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
  available: "Usable",
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

export function getFirstFormErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;

  if ("message" in error && typeof error.message === "string") {
    return error.message;
  }

  if ("root" in error) {
    const rootMessage = getFirstFormErrorMessage(error.root);
    if (rootMessage) return rootMessage;
  }

  for (const value of Object.values(error)) {
    const message = getFirstFormErrorMessage(value);
    if (message) return message;
  }

  return null;
}

/**
 * Build the canonical display name for a variant from the item-card DTO shape.
 * Mirrors what the backend produces in ItemCardVariantDto.displayName — useful
 * for building previews/readouts when only the family + option-values map is
 * known (e.g. preview combinations not yet persisted).
 *
 * Inputs come ordered by option sortOrder; values are joined with " / ".
 */
export function formatVariantDisplayFromFamily(
  family: { name: string },
  optionValues: ReadonlyArray<{ valueLabel: string }>,
): string {
  if (optionValues.length === 0) return family.name;
  return `${family.name} / ${optionValues.map((value) => value.valueLabel).join(" / ")}`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
