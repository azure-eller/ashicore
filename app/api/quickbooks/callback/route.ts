import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import {
  exchangeQuickBooksAuthorizationCode,
  upsertQuickBooksConnection,
} from "@/lib/accounting/providers/quickbooks/client";
import { captureAppError } from "@/lib/observability/sentry";
import { requestUrl } from "@/lib/routing/search-params";

const QUICKBOOKS_STATE_COOKIE = "quickbooks_oauth_state";
const QUICKBOOKS_RETURN_COOKIE = "quickbooks_oauth_return_to";

function readCookie(request: Request, name: string) {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((chunk) => chunk.trim())
    .find((chunk) => chunk.startsWith(`${name}=`))
    ?.split("=")[1];
}

function connectRedirect(request: Request, error?: string) {
  const returnTo = readCookie(request, QUICKBOOKS_RETURN_COOKIE);
  const url = new URL(
    returnTo === "onboarding" ? "/onboarding" : "/settings/integrations",
    request.url,
  );
  if (returnTo === "onboarding") {
    url.searchParams.set("integration", error ? "quickbooks_error" : "quickbooks_connected");
    if (error) url.searchParams.set("error", error);
  } else if (error) {
    url.searchParams.set("error", error);
  }
  return NextResponse.redirect(url);
}

export const GET = apiHandler(async (request: Request) => {
  const context = await getAuthedMemberContext();
  const url = requestUrl(request);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId");
  const cookieState = readCookie(request, QUICKBOOKS_STATE_COOKIE);

  if (!state || !cookieState || state !== cookieState) {
    const response = connectRedirect(request, "quickbooks_state_mismatch");
    response.cookies.delete(QUICKBOOKS_RETURN_COOKIE);
    return response;
  }

  const errorParam = url.searchParams.get("error");
  if (errorParam) {
    const response = connectRedirect(request, errorParam);
    response.cookies.delete(QUICKBOOKS_RETURN_COOKIE);
    return response;
  }
  if (!code || !realmId) {
    const response = connectRedirect(request, "quickbooks_callback_failed");
    response.cookies.delete(QUICKBOOKS_RETURN_COOKIE);
    return response;
  }

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
    const response = connectRedirect(request, "quickbooks_callback_failed");
    response.cookies.delete(QUICKBOOKS_RETURN_COOKIE);
    return response;
  }

  const response = connectRedirect(request);
  response.cookies.delete(QUICKBOOKS_STATE_COOKIE);
  response.cookies.delete(QUICKBOOKS_RETURN_COOKIE);
  return response;
});
