import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { AuthorizationError } from "@/lib/authz";
import { getAuthedApiMemberContext } from "@/lib/dal/auth";
import { getAccountingOAuthStateCookieOptions } from "@/lib/accounting/oauth-cookies";
import { buildGoogleConsentUrl } from "@/lib/marketing/gmail";
import { assertMarketingOrg } from "@/lib/marketing/runtime-policy";

export const GET = apiHandler(async (request: Request) => {
  const context = await getAuthedApiMemberContext(request.headers);
  if (context.role !== "owner") throw new AuthorizationError("Owner access required.", 403);
  assertMarketingOrg(context.orgId);
  const state = randomBytes(24).toString("hex");
  const response = NextResponse.redirect(buildGoogleConsentUrl(state));
  response.cookies.set(
    "marketing_google_oauth_state",
    state,
    getAccountingOAuthStateCookieOptions(),
  );
  return response;
});
