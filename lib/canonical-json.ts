export function normalizeCanonicalNumericString(value: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return value;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return parsed.toString();
}

export function canonicalizeJsonValue(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "string") return normalizeCanonicalNumericString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeJsonValue(entry));
  }

  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .reduce<Record<string, unknown>>((acc, [key, entry]) => {
        acc[key] = canonicalizeJsonValue(entry);
        return acc;
      }, {});
  }

  return String(value);
}

export function canonicalizeJson(value: unknown) {
  return JSON.stringify(canonicalizeJsonValue(value));
}
