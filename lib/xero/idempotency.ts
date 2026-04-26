import "server-only";

import { createHash } from "node:crypto";

/**
 * Build a deterministic Xero idempotency key. Stable across retries so Xero
 * dedupes immediate replays within its ~6-minute retention window. After that
 * window, callers must reconcile by deterministic reference (invoice number,
 * PO number, etc.) before issuing another create.
 *
 * Xero limits idempotency keys to 128 characters. Long org/entity ids are
 * hashed to keep the key bounded.
 */
export function buildXeroIdempotencyKey(
  orgId: string,
  entity: string,
  entityId: string,
  operation: string
): string {
  const raw = `${orgId}:${entity}:${entityId}:${operation}`;
  if (raw.length <= 128) return raw;

  const digest = createHash("sha256").update(raw).digest("hex").slice(0, 32);
  return `${entity}:${operation}:${digest}`;
}
