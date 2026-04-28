import "server-only";

import { getAuthedXeroClient } from "./client";
import {
  XeroError,
  extractXeroMessage,
  redactXeroError,
} from "./errors";

export type XeroConnectionHealth = {
  state:
    | "connected"
    | "needs_reauthorization"
    | "missing_scope"
    | "transient_error";
  message: string | null;
};

/**
 * Server-side health check used during settings page render. Hits Xero
 * with a cheap read so the badge reflects whether the stored tokens
 * still work, rather than just whether a row exists. Caller is
 * responsible for handling the disconnected case (no row → no health
 * check needed).
 */
export async function probeXeroConnectionHealth(
  orgId: string
): Promise<XeroConnectionHealth> {
  try {
    const authed = await getAuthedXeroClient(orgId);
    // 1-row read against PurchaseOrders. Validates the token AND that the
    // accounting.transactions scope is granted, since 1B made it required.
    await authed.client.accountingApi.getPurchaseOrders(
      authed.tenantId,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      1
    );
    return { state: "connected", message: null };
  } catch (error) {
    if (error instanceof XeroError) {
      if (error.status === 401) {
        return { state: "needs_reauthorization", message: error.message };
      }
      if (error.status === 403) {
        return { state: "missing_scope", message: error.message };
      }
      if (error.status === 503) {
        return { state: "transient_error", message: error.message };
      }
      return { state: "transient_error", message: error.message };
    }

    const status =
      (error as { response?: { statusCode?: number } })?.response?.statusCode ??
      (error as { statusCode?: number })?.statusCode;
    if (status === 401) {
      return {
        state: "needs_reauthorization",
        message: "Xero rejected the access token. Reconnect to continue.",
      };
    }
    if (status === 403) {
      return {
        state: "missing_scope",
        message:
          "Xero rejected the request because of missing scopes. Reconnect to grant the required scopes.",
      };
    }
    console.error("Xero health probe failed:", redactXeroError(error));
    return { state: "transient_error", message: extractXeroMessage(error) };
  }
}
