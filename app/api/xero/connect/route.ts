import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { requireModuleWriteAccess } from "@/lib/dal/auth";
import { createXeroClient } from "@/lib/xero/client";
import { tryRecordAccountingAuditEvent } from "@/lib/accounting/audit-events";
import { getAccountingOAuthStateCookieOptions } from "@/lib/accounting/oauth-cookies";
import { ACCOUNTING_PROVIDER_XERO } from "@/lib/accounting/constants";
import { assertNoOtherAccountingConnection } from "@/lib/dal/accounting";

const XERO_CONNECT_RETURN_COOKIE = "xero_oauth_return_to";

function normalizeReturnTo(value: string | null) {
  return value === "onboarding" ? value : null;
}

export const GET = apiHandler(async (request: Request) => {
  const context = await requireModuleWriteAccess("sales");
  await assertNoOtherAccountingConnection(context.orgId, ACCOUNTING_PROVIDER_XERO);
  const url = new URL(request.url);
  const returnTo = normalizeReturnTo(url.searchParams.get("returnTo"));

  const state = randomBytes(24).toString("hex");
  const client = createXeroClient();
  if (client.config) {
    client.config.state = state;
  }

  const consentUrl = await client.buildConsentUrl();
  await tryRecordAccountingAuditEvent({
    organizationId: context.orgId,
    actor: { type: "user", userId: context.userId },
    eventType: "xero_connect_started",
    outcome: "success",
    source: "GET /api/xero/connect",
  });

  const response = NextResponse.redirect(consentUrl);
  response.cookies.set("xero_oauth_state", state, getAccountingOAuthStateCookieOptions());
  if (returnTo) {
    response.cookies.set(
      XERO_CONNECT_RETURN_COOKIE,
      returnTo,
      getAccountingOAuthStateCookieOptions(),
    );
  } else {
    // Clear any return cookie left over from an abandoned onboarding connect so a
    // later settings reconnect isn't bounced back into /onboarding. Match the set
    // options (incl. production domain) so the delete actually clears it.
    response.cookies.set(XERO_CONNECT_RETURN_COOKIE, "", {
      ...getAccountingOAuthStateCookieOptions(),
      maxAge: 0,
    });
  }
  return response;
});
