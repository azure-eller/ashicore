import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { AuthorizationError } from "@/lib/authz";
import {
  exchangeMcpOAuthAuthorizationCode,
  refreshMcpOAuthAccessToken,
} from "@/lib/agent/mcp-oauth/service";

export const runtime = "nodejs";

const authorizationCodeGrantSchema = z.object({
  grant_type: z.literal("authorization_code"),
  code: z.string().min(1),
  client_id: z.string().min(1),
  redirect_uri: z.string().min(1),
  code_verifier: z.string().min(1),
});

const refreshTokenGrantSchema = z.object({
  grant_type: z.literal("refresh_token"),
  refresh_token: z.string().min(1),
  client_id: z.string().min(1),
});

const tokenGrantSchema = z.discriminatedUnion("grant_type", [
  authorizationCodeGrantSchema,
  refreshTokenGrantSchema,
]);

function oauthError(error: string, description: string, status = 400) {
  return NextResponse.json(
    {
      error,
      error_description: description,
    },
    { status }
  );
}

function tokenResponse(result: {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scopes: string[];
}) {
  return NextResponse.json({
    access_token: result.accessToken,
    token_type: "Bearer",
    expires_in: result.expiresIn,
    refresh_token: result.refreshToken,
    scope: result.scopes.join(" "),
  });
}

export const POST = apiHandler(async (request) => {
  const formData = await request.formData();
  const parsed = tokenGrantSchema.safeParse(Object.fromEntries(formData.entries()));

  if (!parsed.success) {
    return oauthError("invalid_request", "Invalid OAuth token request.");
  }

  try {
    if (parsed.data.grant_type === "authorization_code") {
      return tokenResponse(
        await exchangeMcpOAuthAuthorizationCode({
          code: parsed.data.code,
          clientId: parsed.data.client_id,
          redirectUri: parsed.data.redirect_uri,
          codeVerifier: parsed.data.code_verifier,
        })
      );
    }

    return tokenResponse(
      await refreshMcpOAuthAccessToken({
        refreshToken: parsed.data.refresh_token,
        clientId: parsed.data.client_id,
      })
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return oauthError(
        error.status === 401 ? "invalid_grant" : "invalid_request",
        error.message,
        error.status === 401 ? 401 : 400
      );
    }

    throw error;
  }
});
