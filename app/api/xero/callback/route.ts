import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { xeroConnections } from "@/lib/db/schema";
import { withOrgContext } from "@/lib/db/with-org-context";
import {
  createXeroClient,
  tokenSetToPersistable,
  upsertXeroConnection,
} from "@/lib/xero/client";
import { XeroError } from "@/lib/xero/errors";

function settingsRedirect(baseUrl: string, error?: string) {
  const url = new URL("/settings/integrations", baseUrl);
  if (error) url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

export const GET = apiHandler(async (request: Request) => {
  const context = await getAuthedMemberContext();
  const url = new URL(request.url);
  const state = url.searchParams.get("state");

  const cookieState = request.headers
    .get("cookie")
    ?.split(";")
    .map((chunk) => chunk.trim())
    .find((chunk) => chunk.startsWith("xero_oauth_state="))
    ?.split("=")[1];

  if (!state || !cookieState || state !== cookieState) {
    return settingsRedirect(request.url, "state_mismatch");
  }

  const errorParam = url.searchParams.get("error");
  if (errorParam) {
    return settingsRedirect(request.url, errorParam);
  }

  const client = createXeroClient();
  // The xero-node SDK validates the OAuth state against client.config.state
  // before exchanging the code for a token set. Each route creates a fresh
  // XeroClient instance (no shared session storage), so we have to copy the
  // cookie-stored state in here for the SDK's check to pass.
  if (client.config) {
    client.config.state = cookieState;
  }

  try {
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
        .select({ tenantId: xeroConnections.tenantId })
        .from(xeroConnections)
        .where(eq(xeroConnections.organizationId, context.orgId));
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
  } catch (error) {
    console.error("Xero OAuth callback failed:", {
      name: (error as Error)?.name,
      status:
        (error as { response?: { statusCode?: number } })?.response
          ?.statusCode ??
        (error as { statusCode?: number })?.statusCode,
    });
    return settingsRedirect(request.url, "callback_failed");
  }

  const response = settingsRedirect(request.url);
  response.cookies.delete("xero_oauth_state");
  return response;
});
