import "server-only";

import { createHash } from "node:crypto";
import { canonicalizeJson } from "@/lib/canonical-json";

/**
 * Stable sha256 of a Xero push payload. Treat as a local safety check —
 * mismatch on retry means the user edited the order since the previous push
 * attempt. Xero itself does not protect against payload drift beyond the
 * ~6-minute idempotency window.
 */
export function hashXeroPayload(payload: unknown): string {
  return createHash("sha256").update(canonicalizeJson(payload)).digest("hex");
}
