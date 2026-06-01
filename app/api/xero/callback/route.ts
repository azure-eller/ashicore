import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { integrationConnections } from "@/lib/db/schema";
import { withOrgContext } from "@/lib/db/with-org-context";
import { captureAppError } from "@/lib/observability/sentry";
import { requestUrl } from "@/lib/routing/search-params";
import {
  accountingAuditErrorMetadata,
  tryRecordAccountingAuditEvent,
} from "@/lib/accounting/audit-events";
import {
  createXeroClient,
  createXeroSignupClient,
  tokenSetToPersistable,
  upsertXeroConnection,
} from "@/lib/xero/client";
import {
  extractXeroMessage,
  extractXeroStatusCode,
  redactXeroError,
  XeroError,
} from "@/lib/xero/errors";
import {
  buildXeroSignupName,
  createXeroSignupIntent,
  findAshicoreUserByEmail,
} from "@/lib/xero/signup-intents";

const XERO_CONNECT_OAUTH_STATE_COOKIE = "xero_oauth_state";
const XERO_SIGNUP_OAUTH_STATE_COOKIE = "xero_signup_oauth_state";

type XeroIdentityClaims = {
  email?: string;
  given_name?: string;
  family_name?: string;
  name?: string;
  xero_userid?: string;
  sub?: string;
};

function settingsRedirect(baseUrl: string, error?: string) {
  const url = new URL("/settings/integrations", baseUrl);
  if (error) url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

function xeroSignupErrorRedirect(baseUrl: string, reason: string) {
  const url = new URL("/xero/sign-up/error", baseUrl);
  url.searchParams.set("reason", reason);
  return NextResponse.redirect(url);
}

function readCookie(request: Request, name: string) {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((chunk) => chunk.trim())
    .find((chunk) => chunk.startsWith(`${name}=`))
    ?.split("=")[1];
}

function getTokenSetClaims(tokenSet: unknown): XeroIdentityClaims {
  const claims = (tokenSet as { claims?: () => unknown })?.claims?.();
  return claims && typeof claims === "object" ? (claims as XeroIdentityClaims) : {};
}

async function tryRecordConnectCallbackFailure(
  metadata: Record<string, unknown>
) {
  try {
    const context = await getAuthedMemberContext();
    await tryRecordAccountingAuditEvent({
      organizationId: context.orgId,
      actor: { type: "user", userId: context.userId },
      eventType: "xero_connect_callback",
      outcome: "failure",
      source: "GET /api/xero/callback",
      metadata,
    });
  } catch {
    // Signup callbacks and unauthenticated callback failures do not have an org.
  }
}

async function handleConnectCallback(request: Request, cookieState: string) {
  const context = await getAuthedMemberContext();
  const client = createXeroClient();
  // The xero-node SDK validates the OAuth state against client.config.state
  // before exchanging the code for a token set. Each route creates a fresh
  // XeroClient instance (no shared session storage), so we have to copy the
  // cookie-stored state in here for the SDK's check to pass.
  if (client.config) {
    client.config.state = cookieState;
  }

  const tokenSet = await client.apiCallback(request.url);
  const persistable = tokenSetToPersistable({
    access_token: tokenSet.access_token,
    refresh_token: tokenSet.refresh_token,
    expires_at: tokenSet.expires_at,
    expires_in: tokenSet.expires_in,
  });

  await client.updateTenants(false);
  const authorizedTenants = client.tenants.map((tenant) => ({
    tenantId: tenant.tenantId,
    tenantName: tenant.tenantName,
  }));
  if (authorizedTenants.length === 0) {
    throw new XeroError("No Xero tenants are connected to this account.", 409);
  }

  // On reconnect, preserve the previously-active tenant if it still
  // appears in the authorized list. Otherwise fall back to the first
  // tenant Xero returned. Avoids silently swapping the user from one
  // tenant to another when they re-OAuth.
  const existing = await withOrgContext(context.orgId, async (tx) => {
    const [row] = await tx
      .select({ tenantId: integrationConnections.tenantId })
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.organizationId, context.orgId),
          eq(integrationConnections.provider, "xero")
        )
      );
    return row ?? null;
  });

  const primary =
    (existing &&
      authorizedTenants.find((t) => t.tenantId === existing.tenantId)) ??
    authorizedTenants[0];

  await upsertXeroConnection(context.orgId, {
    tenantId: primary.tenantId,
    tenantName: primary.tenantName,
    accessToken: persistable.accessToken,
    refreshToken: persistable.refreshToken,
    expiresAt: persistable.expiresAt,
    authorizedTenants,
  });
  await tryRecordAccountingAuditEvent({
    organizationId: context.orgId,
    actor: { type: "user", userId: context.userId },
    eventType: "xero_connect_callback",
    outcome: "success",
    source: "GET /api/xero/callback",
    tenantId: primary.tenantId,
    tenantName: primary.tenantName,
    metadata: {
      authorizedTenantCount: authorizedTenants.length,
      preservedTenant: existing?.tenantId === primary.tenantId,
    },
  });

  const response = settingsRedirect(request.url);
  response.cookies.delete(XERO_CONNECT_OAUTH_STATE_COOKIE);
  return response;
}

async function handleSignupCallback(request: Request, cookieState: string) {
  const client = createXeroSignupClient();
  if (client.config) {
    client.config.state = cookieState;
  }

  const tokenSet = await client.apiCallback(request.url);
  const claims = getTokenSetClaims(tokenSet);
  const email = claims.email?.toLowerCase();
  const xeroUserId = claims.xero_userid ?? claims.sub;

  if (!email || !xeroUserId) {
    throw new XeroError("Xero did not return the identity details required for signup.", 502);
  }

  const persistable = tokenSetToPersistable({
    access_token: tokenSet.access_token,
    refresh_token: tokenSet.refresh_token,
    expires_at: tokenSet.expires_at,
    expires_in: tokenSet.expires_in,
  });

  await client.updateTenants(false);
  const authorizedTenants = client.tenants.map((tenant) => ({
    tenantId: tenant.tenantId,
    tenantName: tenant.tenantName,
  }));
  if (authorizedTenants.length === 0) {
    throw new XeroError("No Xero tenants are connected to this account.", 409);
  }

  const primary = authorizedTenants[0];
  const name =
    claims.name?.trim() ||
    buildXeroSignupName({
      givenName: claims.given_name,
      familyName: claims.family_name,
      email,
    });

  const intent = await createXeroSignupIntent({
    email,
    name,
    xeroUserId,
    tenantId: primary.tenantId,
    tenantName: primary.tenantName,
    authorizedTenants,
    accessToken: persistable.accessToken,
    refreshToken: persistable.refreshToken,
    expiresAt: persistable.expiresAt,
  });
  const query = `intent=${encodeURIComponent(intent.id)}&token=${encodeURIComponent(intent.token)}`;
  const existingUser = await findAshicoreUserByEmail(email);
  const destination = existingUser
    ? `/xero/sign-up/link?${query}`
    : `/api/auth/xero-signup/complete?${query}`;

  const response = NextResponse.redirect(new URL(destination, request.url));
  response.cookies.delete(XERO_SIGNUP_OAUTH_STATE_COOKIE);
  return response;
}

export const GET = apiHandler(async (request: Request) => {
  const url = requestUrl(request);
  const state = url.searchParams.get("state");
  const connectCookieState = readCookie(request, XERO_CONNECT_OAUTH_STATE_COOKIE);
  const signupCookieState = readCookie(request, XERO_SIGNUP_OAUTH_STATE_COOKIE);
  const isSignupCallback = Boolean(state && signupCookieState === state);
  const isConnectCallback = Boolean(state && connectCookieState === state);

  if (!isSignupCallback && !isConnectCallback) {
    console.warn("Xero OAuth state mismatch:", {
      hasState: Boolean(state),
      hasConnectCookieState: Boolean(connectCookieState),
      hasSignupCookieState: Boolean(signupCookieState),
      host: url.host,
    });
    if (connectCookieState) {
      await tryRecordConnectCallbackFailure({
        reason: "state_mismatch",
        hasState: Boolean(state),
        hasConnectCookieState: Boolean(connectCookieState),
        hasSignupCookieState: Boolean(signupCookieState),
        host: url.host,
      });
    }
    return signupCookieState
      ? xeroSignupErrorRedirect(request.url, "state_mismatch")
      : settingsRedirect(request.url, "state_mismatch");
  }

  const errorParam = url.searchParams.get("error");
  if (errorParam) {
    if (isConnectCallback) {
      await tryRecordConnectCallbackFailure({
        reason: "xero_error_callback",
        error: errorParam,
      });
    }
    return isSignupCallback
      ? xeroSignupErrorRedirect(request.url, errorParam)
      : settingsRedirect(request.url, errorParam);
  }

  try {
    return isSignupCallback
      ? await handleSignupCallback(request, signupCookieState!)
      : await handleConnectCallback(request, connectCookieState!);
  } catch (error) {
    captureAppError(error, {
      route: "/api/xero/callback",
      method: "GET",
      module: "xero",
      operation: isSignupCallback ? "signup_oauth_callback" : "oauth_callback",
      source: "xero_oauth_callback",
      appDebug: {
        error_name: (error as Error)?.name,
        oauth_error: (error as { error?: string })?.error,
        status:
          (error as { response?: { statusCode?: number } })?.response
            ?.statusCode ??
          (error as { statusCode?: number })?.statusCode,
      },
    });
    console.error("Xero OAuth callback failed:", {
      name: (error as Error)?.name,
      message: extractXeroMessage(error),
      status: extractXeroStatusCode(error),
      cause:
        error && typeof error === "object"
          ? redactXeroError((error as { cause?: unknown }).cause)
          : undefined,
    });
    if (!isSignupCallback) {
      await tryRecordConnectCallbackFailure(
        accountingAuditErrorMetadata(error)
      );
    }
    return isSignupCallback
      ? xeroSignupErrorRedirect(request.url, "callback_failed")
      : settingsRedirect(request.url, "callback_failed");
  }
});
