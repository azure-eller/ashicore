import "server-only";

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

export function defaultExtractErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown accounting provider error";
}

export function defaultRedactError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { message: String(error) };
}
