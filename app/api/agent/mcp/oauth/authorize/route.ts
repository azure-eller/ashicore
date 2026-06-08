import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { AuthorizationError } from "@/lib/authz";
import { assertPlanningReadAccess } from "@/lib/planning/auth";
import {
  assertAllowedMcpOAuthRedirectUri,
  createMcpOAuthAuthorizationCode,
} from "@/lib/agent/mcp-oauth/service";
import {
  requestSearchParamRecord,
  requestUrl,
} from "@/lib/routing/search-params";

export const runtime = "nodejs";

const authorizeQuerySchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1),
  redirect_uri: z.string().min(1),
  scope: z.string().optional(),
  state: z.string().optional(),
  code_challenge: z.string().min(1),
  code_challenge_method: z.literal("S256"),
});

function redirectWithOAuthError(redirectUri: string, error: string, state?: string) {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  if (state) {
    url.searchParams.set("state", state);
  }
  return NextResponse.redirect(url);
}

export const GET = apiHandler(async (request) => {
  const url = requestUrl(request);
  const query = authorizeQuerySchema.parse(requestSearchParamRecord(request));
  const redirectUri = assertAllowedMcpOAuthRedirectUri(query.redirect_uri);

  let context: Awaited<ReturnType<typeof assertPlanningReadAccess>>;
  try {
    context = await assertPlanningReadAccess(request.headers);
  } catch (error) {
    if (error instanceof AuthorizationError && error.status === 401) {
      const signInUrl = new URL("/sign-in", request.url);
      signInUrl.searchParams.set(
        "callbackURL",
        `${url.pathname}${url.search}`
      );
      return NextResponse.redirect(signInUrl);
    }
    if (error instanceof AuthorizationError && error.status === 403) {
      return redirectWithOAuthError(redirectUri, "access_denied", query.state);
    }
    throw error;
  }

  const code = await createMcpOAuthAuthorizationCode({
    orgId: context.orgId,
    userId: context.userId,
    clientId: query.client_id,
    redirectUri,
    codeChallenge: query.code_challenge,
    codeChallengeMethod: query.code_challenge_method,
    scope: query.scope,
  }).catch((error) => {
    if (error instanceof AuthorizationError) {
      return redirectWithOAuthError(redirectUri, "invalid_request", query.state);
    }
    throw error;
  });

  if (code instanceof NextResponse) {
    return code;
  }

  const redirectUrl = new URL(redirectUri);
  redirectUrl.searchParams.set("code", code);
  if (query.state) {
    redirectUrl.searchParams.set("state", query.state);
  }

  return NextResponse.redirect(redirectUrl);
});
