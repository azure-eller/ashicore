import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { requireModuleWriteAccess } from "@/lib/dal/auth";
import { createXeroClient } from "@/lib/xero/client";

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
  await requireModuleWriteAccess("sales");

  const state = randomBytes(24).toString("hex");
  const client = createXeroClient();
  if (client.config) {
    client.config.state = state;
  }

  const consentUrl = await client.buildConsentUrl();

  const response = NextResponse.redirect(consentUrl);
  response.cookies.set("xero_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
    domain: getCookieDomain(),
  });
  return response;
});
