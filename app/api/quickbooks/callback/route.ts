import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import {
  exchangeQuickBooksAuthorizationCode,
  upsertQuickBooksConnection,
} from "@/lib/accounting/providers/quickbooks/client";
import { captureAppError } from "@/lib/observability/sentry";

function settingsRedirect(baseUrl: string, error?: string) {
  const url = new URL("/settings/integrations", baseUrl);
  if (error) url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

export const GET = apiHandler(async (request: Request) => {
  const context = await getAuthedMemberContext();
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId");
  const cookieState = request.headers
    .get("cookie")
    ?.split(";")
    .map((chunk) => chunk.trim())
    .find((chunk) => chunk.startsWith("quickbooks_oauth_state="))
    ?.split("=")[1];

  if (!state || !cookieState || state !== cookieState) {
    return settingsRedirect(request.url, "quickbooks_state_mismatch");
  }

  const errorParam = url.searchParams.get("error");
  if (errorParam) return settingsRedirect(request.url, errorParam);
  if (!code || !realmId) return settingsRedirect(request.url, "quickbooks_callback_failed");

  try {
    const tokenSet = await exchangeQuickBooksAuthorizationCode({ code, realmId });
    await upsertQuickBooksConnection(context.orgId, {
      realmId,
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      expiresAt: tokenSet.expiresAt,
    });
  } catch (error) {
    captureAppError(error, {
      route: "/api/quickbooks/callback",
      method: "GET",
      module: "accounting",
      operation: "quickbooks_oauth_callback",
      source: "quickbooks_oauth_callback",
    });
    return settingsRedirect(request.url, "quickbooks_callback_failed");
  }

  const response = settingsRedirect(request.url);
  response.cookies.delete("quickbooks_oauth_state");
  return response;
});
