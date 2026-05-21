import "server-only";

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { AuthorizationError } from "@/lib/authz";
import {
  agentMcpOAuthCodes,
  agentMcpOAuthTokens,
  type AgentMcpOAuthScope,
} from "@/lib/db/schema";
import { type Tx, withOrgContext } from "@/lib/db/with-org-context";

const CODE_PREFIX = "ash_mcp_code";
const ACCESS_TOKEN_PREFIX = "ash_mcp_access";
const REFRESH_TOKEN_PREFIX = "ash_mcp_refresh";
const PRODUCTION_PLANNING_SCOPE: AgentMcpOAuthScope = "production_planning:read";
const CODE_TTL_SECONDS = 10 * 60;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

type ParsedOpaqueToken = {
  prefix: string;
  orgId: string;
  id: string;
  token: string;
};

export type McpOAuthTokenAuth = {
  orgId: string;
  userId: string;
  clientId: string;
  scopes: AgentMcpOAuthScope[];
  expiresAt: Date;
};

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function safeEqualHex(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function addSeconds(date: Date, seconds: number) {
  return new Date(date.getTime() + seconds * 1000);
}

function newOpaqueToken(prefix: string, orgId: string, id: string = randomUUID()) {
  const secret = randomBytes(32).toString("base64url");
  return {
    id,
    token: `${prefix}.${orgId}.${id}.${secret}`,
  };
}

function parseOpaqueToken(token: string, prefix: string): ParsedOpaqueToken | null {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== prefix) return null;
  const [, orgId, id, secret] = parts;
  if (!orgId || !id || !secret) return null;
  return { prefix, orgId, id, token };
}

function scopeList(scope: string | null | undefined) {
  const scopes = new Set(
    (scope ?? PRODUCTION_PLANNING_SCOPE)
      .split(/\s+/)
      .map((value) => value.trim())
      .filter(Boolean)
  );

  if (!scopes.has(PRODUCTION_PLANNING_SCOPE)) {
    throw new AuthorizationError("Unsupported OAuth scope.", 400);
  }

  return [PRODUCTION_PLANNING_SCOPE];
}

function isClaudeWebRedirect(uri: URL) {
  return uri.protocol === "https:" && uri.host === "claude.ai" && uri.pathname === "/api/mcp/auth_callback";
}

function isClaudeCodeRedirect(uri: URL) {
  if (uri.protocol !== "http:") return false;
  if (uri.hostname !== "localhost" && uri.hostname !== "127.0.0.1") return false;
  return uri.pathname === "/callback";
}

export function assertAllowedMcpOAuthRedirectUri(redirectUri: string) {
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new AuthorizationError("Invalid OAuth redirect URI.", 400);
  }

  if (!isClaudeWebRedirect(parsed) && !isClaudeCodeRedirect(parsed)) {
    throw new AuthorizationError("Unsupported OAuth redirect URI.", 400);
  }

  return parsed.toString();
}

export function verifyPkceChallenge(args: {
  codeVerifier: string;
  codeChallenge: string;
  method: string;
}) {
  if (args.method !== "S256") {
    throw new AuthorizationError("Unsupported PKCE challenge method.", 400);
  }

  const digest = createHash("sha256").update(args.codeVerifier).digest("base64url");
  if (digest !== args.codeChallenge) {
    throw new AuthorizationError("Invalid PKCE verifier.", 401);
  }
}

export async function createMcpOAuthAuthorizationCode(input: {
  orgId: string;
  userId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope?: string | null;
}) {
  if (!input.clientId.trim()) {
    throw new AuthorizationError("OAuth client_id is required.", 400);
  }
  if (!input.codeChallenge.trim()) {
    throw new AuthorizationError("OAuth code_challenge is required.", 400);
  }
  if (input.codeChallengeMethod !== "S256") {
    throw new AuthorizationError("Only S256 PKCE is supported.", 400);
  }

  const redirectUri = assertAllowedMcpOAuthRedirectUri(input.redirectUri);
  const scopes = scopeList(input.scope);
  const code = newOpaqueToken(CODE_PREFIX, input.orgId);
  const now = new Date();

  await withOrgContext(input.orgId, async (tx) => {
    await tx.insert(agentMcpOAuthCodes).values({
      id: code.id,
      organizationId: input.orgId,
      userId: input.userId,
      clientId: input.clientId,
      redirectUri,
      codeHash: hashToken(code.token),
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: input.codeChallengeMethod,
      scopes,
      expiresAt: addSeconds(now, CODE_TTL_SECONDS),
    });
  });

  return code.token;
}

async function exchangeAuthorizationCodeInTx(
  tx: Tx,
  parsedCode: ParsedOpaqueToken,
  input: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
  }
) {
  const [row] = await tx
    .select()
    .from(agentMcpOAuthCodes)
    .where(and(eq(agentMcpOAuthCodes.id, parsedCode.id), isNull(agentMcpOAuthCodes.consumedAt)))
    .limit(1);

  if (!row || !safeEqualHex(row.codeHash, hashToken(input.code))) {
    throw new AuthorizationError("Invalid OAuth authorization code.", 401);
  }
  if (row.expiresAt <= new Date()) {
    throw new AuthorizationError("OAuth authorization code has expired.", 401);
  }
  if (row.clientId !== input.clientId) {
    throw new AuthorizationError("OAuth client mismatch.", 401);
  }
  if (row.redirectUri !== assertAllowedMcpOAuthRedirectUri(input.redirectUri)) {
    throw new AuthorizationError("OAuth redirect URI mismatch.", 401);
  }

  verifyPkceChallenge({
    codeVerifier: input.codeVerifier,
    codeChallenge: row.codeChallenge,
    method: row.codeChallengeMethod,
  });

  await tx
    .update(agentMcpOAuthCodes)
    .set({ consumedAt: new Date() })
    .where(eq(agentMcpOAuthCodes.id, row.id));

  return issueMcpOAuthTokenGrantInTx(tx, {
    orgId: parsedCode.orgId,
    userId: row.userId,
    clientId: row.clientId,
    scopes: row.scopes,
  });
}

async function issueMcpOAuthTokenGrantInTx(
  tx: Tx,
  input: {
    orgId: string;
    userId: string;
    clientId: string;
    scopes: AgentMcpOAuthScope[];
  }
) {
  const tokenId = randomUUID();
  const access = newOpaqueToken(ACCESS_TOKEN_PREFIX, input.orgId, tokenId);
  const refresh = newOpaqueToken(REFRESH_TOKEN_PREFIX, input.orgId, tokenId);
  const now = new Date();
  const accessTokenExpiresAt = addSeconds(now, ACCESS_TOKEN_TTL_SECONDS);
  const refreshTokenExpiresAt = addSeconds(now, REFRESH_TOKEN_TTL_SECONDS);

  await tx.insert(agentMcpOAuthTokens).values({
    id: tokenId,
    organizationId: input.orgId,
    userId: input.userId,
    clientId: input.clientId,
    accessTokenHash: hashToken(access.token),
    refreshTokenHash: hashToken(refresh.token),
    scopes: input.scopes,
    accessTokenExpiresAt,
    refreshTokenExpiresAt,
  });

  return {
    accessToken: access.token,
    refreshToken: refresh.token,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    scopes: input.scopes,
  };
}

export async function exchangeMcpOAuthAuthorizationCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}) {
  const parsedCode = parseOpaqueToken(input.code, CODE_PREFIX);
  if (!parsedCode) {
    throw new AuthorizationError("Invalid OAuth authorization code.", 401);
  }

  return withOrgContext(parsedCode.orgId, (tx) =>
    exchangeAuthorizationCodeInTx(tx, parsedCode, input)
  );
}

export async function refreshMcpOAuthAccessToken(input: {
  refreshToken: string;
  clientId: string;
}) {
  const parsedRefreshToken = parseOpaqueToken(input.refreshToken, REFRESH_TOKEN_PREFIX);
  if (!parsedRefreshToken) {
    throw new AuthorizationError("Invalid OAuth refresh token.", 401);
  }

  return withOrgContext(parsedRefreshToken.orgId, async (tx) => {
    const [row] = await tx
      .select()
      .from(agentMcpOAuthTokens)
      .where(
        and(
          eq(agentMcpOAuthTokens.id, parsedRefreshToken.id),
          isNull(agentMcpOAuthTokens.revokedAt)
        )
      )
      .limit(1);

    if (!row || !safeEqualHex(row.refreshTokenHash, hashToken(input.refreshToken))) {
      throw new AuthorizationError("Invalid OAuth refresh token.", 401);
    }
    if (row.clientId !== input.clientId) {
      throw new AuthorizationError("OAuth client mismatch.", 401);
    }
    if (row.refreshTokenExpiresAt <= new Date()) {
      throw new AuthorizationError("OAuth refresh token has expired.", 401);
    }

    const access = newOpaqueToken(ACCESS_TOKEN_PREFIX, parsedRefreshToken.orgId, row.id);
    const refresh = newOpaqueToken(REFRESH_TOKEN_PREFIX, parsedRefreshToken.orgId, row.id);
    const accessTokenExpiresAt = addSeconds(new Date(), ACCESS_TOKEN_TTL_SECONDS);
    const refreshTokenExpiresAt = addSeconds(new Date(), REFRESH_TOKEN_TTL_SECONDS);

    await tx
      .update(agentMcpOAuthTokens)
      .set({
        accessTokenHash: hashToken(access.token),
        refreshTokenHash: hashToken(refresh.token),
        accessTokenExpiresAt,
        refreshTokenExpiresAt,
        updatedAt: new Date(),
      })
      .where(eq(agentMcpOAuthTokens.id, row.id));

    return {
      accessToken: access.token,
      refreshToken: refresh.token,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      scopes: row.scopes,
    };
  });
}

export async function authenticateMcpOAuthAccessToken(
  token: string | undefined
): Promise<McpOAuthTokenAuth | null> {
  if (!token) return null;

  const parsedAccessToken = parseOpaqueToken(token, ACCESS_TOKEN_PREFIX);
  if (!parsedAccessToken) return null;

  return withOrgContext(parsedAccessToken.orgId, async (tx) => {
    const [row] = await tx
      .select()
      .from(agentMcpOAuthTokens)
      .where(
        and(
          eq(agentMcpOAuthTokens.id, parsedAccessToken.id),
          isNull(agentMcpOAuthTokens.revokedAt)
        )
      )
      .limit(1);

    if (!row || !safeEqualHex(row.accessTokenHash, hashToken(token))) {
      return null;
    }
    if (row.accessTokenExpiresAt <= new Date()) {
      return null;
    }

    await tx
      .update(agentMcpOAuthTokens)
      .set({ lastUsedAt: new Date(), updatedAt: new Date() })
      .where(eq(agentMcpOAuthTokens.id, row.id));

    return {
      orgId: parsedAccessToken.orgId,
      userId: row.userId,
      clientId: row.clientId,
      scopes: row.scopes,
      expiresAt: row.accessTokenExpiresAt,
    };
  });
}
