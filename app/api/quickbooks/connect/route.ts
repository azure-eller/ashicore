import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { requireModuleWriteAccess } from "@/lib/dal/auth";
import { buildQuickBooksAuthorizationUrl } from "@/lib/accounting/providers/quickbooks/client";
import { getAccountingOAuthStateCookieOptions } from "@/lib/accounting/oauth-cookies";
import {
  ACCOUNTING_PROVIDER_QUICKBOOKS,
} from "@/lib/accounting/constants";
import { assertNoOtherAccountingConnection } from "@/lib/dal/accounting";

export const GET = apiHandler(async () => {
  const context = await requireModuleWriteAccess("sales");
  await assertNoOtherAccountingConnection(
    context.orgId,
    ACCOUNTING_PROVIDER_QUICKBOOKS
  );

  const state = randomBytes(24).toString("hex");
  const response = NextResponse.redirect(buildQuickBooksAuthorizationUrl(state));
  response.cookies.set("quickbooks_oauth_state", state, getAccountingOAuthStateCookieOptions());
  return response;
});
