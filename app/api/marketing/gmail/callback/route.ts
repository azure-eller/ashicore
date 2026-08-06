import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { AuthorizationError } from "@/lib/authz";
import { getAuthedApiMemberContext } from "@/lib/dal/auth";
import { exchangeGoogleCode, saveMarketingMailbox } from "@/lib/marketing/gmail";
import { assertMarketingOrg } from "@/lib/marketing/runtime-policy";

export const GET = apiHandler(async (request: Request) => {
  const context = await getAuthedApiMemberContext(request.headers);
  if (context.role !== "owner") throw new AuthorizationError("Owner access required.", 403);
  assertMarketingOrg(context.orgId);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("marketing_google_oauth_state="))
    ?.split("=")[1];
  if (!code || !state || !cookieState || state !== cookieState) {
    throw new AuthorizationError("Invalid Google OAuth callback state.", 401);
  }
  const token = await exchangeGoogleCode(code);
  if (!token.refresh_token) {
    throw new AuthorizationError("Google did not return an offline refresh token.", 409);
  }
  await saveMarketingMailbox({
    orgId: context.orgId,
    userId: context.userId,
    accessToken: token.access_token!,
    refreshToken: token.refresh_token,
    expiresIn: token.expires_in ?? 3_600,
  });
  const response = NextResponse.redirect(new URL("/settings/integrations?gmail=connected", request.url));
  response.cookies.delete("marketing_google_oauth_state");
  return response;
});
