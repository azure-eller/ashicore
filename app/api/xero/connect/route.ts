import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { requireModuleWriteAccess } from "@/lib/dal/auth";
import { createXeroClient } from "@/lib/xero/client";
import { tryRecordAccountingAuditEvent } from "@/lib/accounting/audit-events";
import { getAccountingOAuthStateCookieOptions } from "@/lib/accounting/oauth-cookies";

export const GET = apiHandler(async () => {
  const context = await requireModuleWriteAccess("sales");

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
  return response;
});
