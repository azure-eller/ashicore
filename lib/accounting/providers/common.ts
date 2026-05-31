import "server-only";

import { normalizeNumeric } from "@/lib/format";

export function cleanString(value: unknown, maxLength = 255) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

export function cleanDate(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function asDateString(value: unknown) {
  const date = cleanDate(value);
  return date ? date.toISOString().slice(0, 10) : null;
}

export function normalizeProviderKey(value: string | null | undefined) {
  return cleanString(value)?.toLowerCase() ?? null;
}

export function compactProviderKey(value: string | null | undefined) {
  return cleanString(value)?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? null;
}

export function normalizeProviderNumeric(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null;
  return normalizeNumeric(value);
}

export function defaultExtractErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown accounting provider error";
}

export function defaultRedactError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { message: String(error) };
}
