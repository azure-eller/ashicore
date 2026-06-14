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

const QUICKBOOKS_RETURN_COOKIE = "quickbooks_oauth_return_to";

function normalizeReturnTo(value: string | null) {
  return value === "onboarding" ? value : null;
}

export const GET = apiHandler(async (request: Request) => {
  const context = await requireModuleWriteAccess("sales");
  await assertNoOtherAccountingConnection(
    context.orgId,
    ACCOUNTING_PROVIDER_QUICKBOOKS
  );
  const url = new URL(request.url);
  const returnTo = normalizeReturnTo(url.searchParams.get("returnTo"));

  const state = randomBytes(24).toString("hex");
  const response = NextResponse.redirect(buildQuickBooksAuthorizationUrl(state));
  response.cookies.set("quickbooks_oauth_state", state, getAccountingOAuthStateCookieOptions());
  if (returnTo) {
    response.cookies.set(
      QUICKBOOKS_RETURN_COOKIE,
      returnTo,
      getAccountingOAuthStateCookieOptions(),
    );
  } else {
    // Clear any return cookie left over from an abandoned onboarding connect so a
    // later settings reconnect isn't bounced back into /onboarding. Match the set
    // options (incl. production domain) so the delete actually clears it.
    response.cookies.set(QUICKBOOKS_RETURN_COOKIE, "", {
      ...getAccountingOAuthStateCookieOptions(),
      maxAge: 0,
    });
  }
  return response;
});
