import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess, withAuthedOrgContext } from "@/lib/dal/auth";
import { getAuthedXeroClient } from "@/lib/xero/client";
import {
  XeroError,
  extractXeroMessage,
  redactXeroError,
} from "@/lib/xero/errors";

export const dynamic = "force-dynamic";

type TestState =
  | "connected"
  | "disconnected"
  | "needs_reauthorization"
  | "missing_scope"
  | "token_refresh_failed"
  | "unknown_error";

type TestResult = {
  state: TestState;
  message: string;
  tenantName?: string;
};

function classifyError(error: unknown): TestResult {
  if (error instanceof XeroError) {
    if (error.message.includes("not connected")) {
      return { state: "disconnected", message: error.message };
    }
    if (error.status === 401) {
      return { state: "needs_reauthorization", message: error.message };
    }
    if (error.status === 403) {
      return { state: "missing_scope", message: error.message };
    }
    if (error.status === 503) {
      // Transient — Xero unreachable, refresh blip, etc. Don't push the
      // user toward a reconnect they don't need.
      return { state: "unknown_error", message: error.message };
    }
    return { state: "unknown_error", message: error.message };
  }

  // Xero SDK surfaces HTTP errors via response.statusCode
  const status =
    (error as { response?: { statusCode?: number } })?.response?.statusCode ??
    (error as { statusCode?: number })?.statusCode;

  if (status === 401) {
    return {
      state: "needs_reauthorization",
      message: "Xero rejected the access token. Reconnect Xero in settings.",
    };
  }
  if (status === 403) {
    return {
      state: "missing_scope",
      message:
        "Xero rejected the request because of missing scopes. Reconnect Xero to grant the required scopes.",
    };
  }

  return { state: "unknown_error", message: extractXeroMessage(error) };
}

export const POST = apiHandler(async (request: Request) => {
  await assertModuleWriteAccess("sales", request.headers);

  return withAuthedOrgContext(async (_tx, orgId) => {
    let result: TestResult;

    try {
      const authed = await getAuthedXeroClient(orgId);
      // Light read against PurchaseOrders. If 1B's accounting.transactions
      // scope is missing, this surfaces it as 403.
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
      result = {
        state: "connected",
        message: "Xero responded successfully.",
        tenantName: authed.tenantName,
      };
    } catch (error) {
      console.error("Xero connection test failed:", redactXeroError(error));
      result = classifyError(error);
    }

    return NextResponse.json(result);
  });
});
