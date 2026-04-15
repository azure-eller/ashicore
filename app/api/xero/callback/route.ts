import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import {
  createXeroClient,
  tokenSetToPersistable,
  upsertXeroConnection,
} from "@/lib/xero/client";
import { XeroError, redactXeroError } from "@/lib/xero/errors";

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

  try {
    const tokenSet = await client.apiCallback(request.url);
    const persistable = tokenSetToPersistable({
      access_token: tokenSet.access_token,
      refresh_token: tokenSet.refresh_token,
      expires_at: tokenSet.expires_at,
      expires_in: tokenSet.expires_in,
    });

    await client.updateTenants(false);
    const tenant = client.tenants[0];
    if (!tenant) {
      throw new XeroError("No Xero tenants are connected to this account.", 409);
    }

    await upsertXeroConnection(context.orgId, {
      tenantId: tenant.tenantId,
      tenantName: tenant.tenantName,
      accessToken: persistable.accessToken,
      refreshToken: persistable.refreshToken,
      expiresAt: persistable.expiresAt,
    });
  } catch (error) {
    console.error(
      "Xero OAuth callback failed:",
      redactXeroError(error)
    );
    return settingsRedirect(request.url, "callback_failed");
  }

  const response = settingsRedirect(request.url);
  response.cookies.delete("xero_oauth_state");
  return response;
});
