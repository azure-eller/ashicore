import type { InventoryDisposition } from "@/lib/db/schema";
import { formatItemDisplayName } from "@/lib/inventory/display-name";
import { isValidTimeZone } from "@/lib/time-zone";

type CurrencyFormatOptions = {
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
};

const currencyFormats = new Map<string, Intl.NumberFormat>();

export function formatCurrency(
  value: string | number | null | undefined,
  currency = "USD",
  options: CurrencyFormatOptions = {},
): string | null {
  if (value == null) return null;

  const normalizedCurrency = currency.toUpperCase();
  const key = [
    normalizedCurrency,
    options.minimumFractionDigits ?? "",
    options.maximumFractionDigits ?? "",
  ].join(":");
  let formatter = currencyFormats.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalizedCurrency,
      ...options,
    });
    currencyFormats.set(key, formatter);
  }

  const parsedValue = typeof value === "number" ? value : parseFloat(value);
  const numericValue =
    Number.isFinite(parsedValue) && Math.abs(parsedValue) < 0.005 ? 0 : parsedValue;
  return formatter.format(numericValue);
}

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
  return formatCurrency(value, "USD");
}

export function formatCost(value: string | null | undefined): string | null {
  if (value == null) return null;
  return costFormat.format(parseFloat(value));
}

export function formatPercent(
  value: unknown,
  options: { fallback?: string; fractionDigits?: number } = {},
) {
  const { fallback = "\u2014", fractionDigits = 1 } = options;
  const parsed = value == null ? NaN : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return `${parsed.toFixed(fractionDigits)}%`;
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
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
 * Convert an exact timestamp or already-date-only value into a YYYY-MM-DD business
 * date string for display helpers that intentionally avoid timezone conversion.
 */
export function toDateOnlyString(
  value: Date | string | null | undefined,
): string | null {
  if (value == null) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  return new Date(value).toISOString().slice(0, 10);
}

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

export function parseLocalDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;

  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return undefined;
  }

  return date;
}

export function formatLocalDateInput(date: Date): string {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

export function parseLocalDateTime(value?: string): Date | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const match = trimmed.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/
  );
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = match[4] != null ? Number(match[4]) : 0;
  const minute = match[5] != null ? Number(match[5]) : 0;
  const second = match[6] != null ? Number(match[6]) : 0;

  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  if (hour > 23 || minute > 59 || second > 59) return undefined;

  const date = new Date(year, month - 1, day, hour, minute, second, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return undefined;
  }

  return date;
}

export function formatLocalDateTimeInput(date: Date): string {
  return `${formatLocalDateInput(date)}T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}:${padDatePart(date.getSeconds())}`;
}

export function formatLongLocalDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatLongLocalDateTime(date: Date): string {
  return `${formatLongLocalDate(date)} at ${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;
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

export function formatDateTimeLabel(
  value: string | Date | null | undefined,
  timeZone: string,
): string {
  if (value == null) return "\u2014";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return typeof value === "string" ? value : "\u2014";
  }
  return formatDateTime(date, timeZone);
}

export function dateInTimeZone(value: Date, timeZone: string): string {
  if (!isValidTimeZone(timeZone)) {
    throw new Error(`Invalid IANA timezone: ${timeZone}`);
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error(`Unable to format today's date for timezone: ${timeZone}`);
  }

  return `${year}-${month}-${day}`;
}

export function todayInTimeZone(timeZone: string): string {
  return dateInTimeZone(new Date(), timeZone);
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
  // Round to the canonical quantity scale (4 dp) before display. This strips
  // trailing zeros AND absorbs JS float artifacts (e.g. "10.700000000000001"
  // -> "10.7"), so a computed number stringified upstream can never leak its
  // binary representation to the screen.
  return normalizeNumericScale(parseFloat(value), 4);
}

export function formatQuantityWithUnitText(
  value: string | number | null | undefined,
  unitName: string | null | undefined,
): string {
  const quantity = formatQuantity(value == null ? null : String(value));
  return [quantity, unitName].filter(Boolean).join(" ");
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
  const result = value.toFixed(scale).replace(/\.?0+$/, "");
  // A tiny negative float artifact (e.g. -5.5e-17) rounds to "-0"; collapse it.
  return result === "-0" ? "0" : result;
}

/**
 * Normalize a number for Postgres numeric storage.
 * Strips trailing zeros: 1.5 → "1.5", 10 → "10", 0 → "0".
 * Use for ALL numeric writes — quantities, costs, amounts, prices.
 */
export function normalizeNumeric(value: number): string {
  return normalizeNumericScale(value, 4);
}

export function normalizeQuantityNumber(value: number): number {
  return Number(normalizeNumeric(value));
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
  return parsePositiveNumber(value);
}

export function parseQuantity(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseFiniteNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseNumberOrZero(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseNonNegativeNumber(
  value: string | number | null | undefined,
): number | null {
  const parsed = parseFiniteNumber(value);
  return parsed != null && parsed >= 0 ? parsed : null;
}

export function parsePositiveNumber(value: string | number | null | undefined): number | null {
  const parsed = parseFiniteNumber(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

export function normalizeTextValue(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

export function normalizeNullableTextValue(value: unknown): string | null {
  const text = normalizeTextValue(value);
  return text === "" ? null : text;
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

export type FormErrorState = Record<string, unknown>;

export function setFormErrorPath(
  target: FormErrorState,
  path: PropertyKey[],
  message: string,
) {
  let current: Record<string, unknown> = target;
  path.forEach((part, index) => {
    const key = String(part);
    if (index === path.length - 1) {
      current[key] = { message };
      return;
    }

    const next = current[key];
    if (!next || typeof next !== "object") {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  });
}

export function buildFormErrorStateFromIssues(
  issues: Array<{ path: PropertyKey[]; message: string }>,
) {
  const errors: FormErrorState = {};
  issues.forEach((issue) => {
    setFormErrorPath(errors, issue.path, issue.message);
  });
  return errors;
}

export function buildFormErrorStateFromFieldErrors(
  fieldErrors: Record<string, string[]> | null | undefined,
) {
  const errors: FormErrorState = {};
  Object.entries(fieldErrors ?? {}).forEach(([field, messages]) => {
    setFormErrorPath(errors, field.split("."), messages[0] ?? "Invalid value");
  });
  return errors;
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

export function getNestedFormErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { message?: unknown; root?: unknown };
  if (typeof candidate.message === "string") return candidate.message;
  return getNestedFormErrorMessage(candidate.root);
}

export function getIndexedFormErrorMessage<Key extends string>(
  error: unknown,
  rowIndex: number,
  key: Key,
): string | null {
  if (!error || typeof error !== "object") return null;
  const rowError = (error as Record<string, unknown>)[rowIndex];
  if (!rowError || typeof rowError !== "object") return null;
  return getNestedFormErrorMessage((rowError as Record<string, unknown>)[key]);
}

export function buildIndexedFormErrorMap<Row, Key extends string>(
  error: unknown,
  rows: Row[],
  keys: Key[],
  getRowId: (row: Row) => string,
): Map<string, Map<Key, string>> {
  const byRowId = new Map<string, Map<Key, string>>();
  const rowErrors = Array.isArray(error) ? error : [];

  rowErrors.forEach((rowError, index) => {
    const row = rows[index];
    if (!row || !rowError || typeof rowError !== "object") return;

    const rowErrorObject = rowError as Record<string, unknown>;
    const rowMessages = new Map<Key, string>();
    keys.forEach((key) => {
      const message = getNestedFormErrorMessage(rowErrorObject[key]);
      if (message) rowMessages.set(key, message);
    });

    if (rowMessages.size > 0) byRowId.set(getRowId(row), rowMessages);
  });

  return byRowId;
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
  return formatItemDisplayName({
    name: family.name,
    familyName: family.name,
    optionLabels: optionValues.map((value) => value.valueLabel),
  });
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
