import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { createXeroSignupClient } from "@/lib/xero/client";
import { getAccountingOAuthStateCookieOptions } from "@/lib/accounting/oauth-cookies";

export const XERO_SIGNUP_OAUTH_STATE_COOKIE = "xero_signup_oauth_state";

export const GET = apiHandler(async () => {
  const state = randomBytes(24).toString("hex");
  const client = createXeroSignupClient();
  if (client.config) {
    client.config.state = state;
  }

  const consentUrl = await client.buildConsentUrl();

  const response = NextResponse.redirect(consentUrl);
  response.cookies.set(
    XERO_SIGNUP_OAUTH_STATE_COOKIE,
    state,
    getAccountingOAuthStateCookieOptions(),
  );
  return response;
});
