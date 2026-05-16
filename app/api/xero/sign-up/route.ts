import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { createXeroSignupClient } from "@/lib/xero/client";

export const XERO_SIGNUP_OAUTH_STATE_COOKIE = "xero_signup_oauth_state";

function getCookieDomain() {
  if (process.env.VERCEL_ENV !== "production") {
    return undefined;
  }

  const appUrl = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return undefined;

  try {
    const hostname = new URL(appUrl).hostname;
    return hostname === "ashicore.app" || hostname === "www.ashicore.app"
      ? ".ashicore.app"
      : undefined;
  } catch {
    return undefined;
  }
}

export const GET = apiHandler(async () => {
  const state = randomBytes(24).toString("hex");
  const client = createXeroSignupClient();
  if (client.config) {
    client.config.state = state;
  }

  const consentUrl = await client.buildConsentUrl();

  const response = NextResponse.redirect(consentUrl);
  response.cookies.set(XERO_SIGNUP_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
    domain: getCookieDomain(),
  });
  return response;
});
