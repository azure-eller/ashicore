import "server-only";

import { createHash } from "node:crypto";

function normalizeNumericString(value: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return value;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return parsed.toString();
}

function canonicalize(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "string") return normalizeNumericString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }

  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .reduce<Record<string, unknown>>((acc, [key, entry]) => {
        acc[key] = canonicalize(entry);
        return acc;
      }, {});
  }

  return String(value);
}

/**
 * Stable sha256 of a Xero push payload. Treat as a local safety check —
 * mismatch on retry means the user edited the order since the previous push
 * attempt. Xero itself does not protect against payload drift beyond the
 * ~6-minute idempotency window.
 */
export function hashXeroPayload(payload: unknown): string {
  const canonical = JSON.stringify(canonicalize(payload));
  return createHash("sha256").update(canonical).digest("hex");
}
