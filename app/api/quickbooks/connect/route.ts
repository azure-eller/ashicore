import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { requireModuleWriteAccess } from "@/lib/dal/auth";
import { buildQuickBooksAuthorizationUrl } from "@/lib/accounting/providers/quickbooks/client";
import { getAccountingOAuthStateCookieOptions } from "@/lib/accounting/oauth-cookies";

export const GET = apiHandler(async () => {
  await requireModuleWriteAccess("sales");

  const state = randomBytes(24).toString("hex");
  const response = NextResponse.redirect(buildQuickBooksAuthorizationUrl(state));
  response.cookies.set("quickbooks_oauth_state", state, getAccountingOAuthStateCookieOptions());
  return response;
});
