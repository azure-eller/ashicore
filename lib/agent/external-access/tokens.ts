import "server-only";

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { AuthorizationError } from "@/lib/authz";
import { agentApiTokens, type AgentApiTokenScope } from "@/lib/db/schema";
import { type Tx, withOrgContext } from "@/lib/db/with-org-context";
import { withAuthedOrgContext } from "@/lib/dal/auth";

const TOKEN_PREFIX = "ash_agent";
const DEFAULT_SCOPES: AgentApiTokenScope[] = ["production_planning:read"];

type ParsedAgentToken = {
  orgId: string;
  tokenId: string;
  token: string;
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

function parseAgentToken(token: string): ParsedAgentToken | null {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== TOKEN_PREFIX) return null;
  const [, orgId, tokenId, secret] = parts;
  if (!orgId || !tokenId || !secret) return null;
  return { orgId, tokenId, token };
}

function serializeAgentToken(args: { orgId: string; tokenId: string; secret: string }) {
  return `${TOKEN_PREFIX}.${args.orgId}.${args.tokenId}.${args.secret}`;
}

function publicTokenPrefix(args: { tokenId: string; secret: string }) {
  return `${TOKEN_PREFIX}.${args.tokenId.slice(0, 8)}.${args.secret.slice(0, 6)}`;
}

function toTokenSummary(row: typeof agentApiTokens.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    scopes: row.scopes,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listAgentApiTokens() {
  return withAuthedOrgContext(async (tx) => {
    const rows = await tx
      .select()
      .from(agentApiTokens)
      .orderBy(desc(agentApiTokens.createdAt), desc(agentApiTokens.id));

    return rows.map(toTokenSummary);
  });
}

export async function createAgentApiToken(input: {
  name: string;
  expiresAt?: Date | null;
}) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const tokenId = randomUUID();
    const secret = randomBytes(32).toString("base64url");
    const token = serializeAgentToken({ orgId, tokenId, secret });
    const [row] = await tx
      .insert(agentApiTokens)
      .values({
        id: tokenId,
        organizationId: orgId,
        createdByUserId: userId,
        name: input.name,
        tokenHash: hashToken(token),
        tokenPrefix: publicTokenPrefix({ tokenId, secret }),
        scopes: DEFAULT_SCOPES,
        expiresAt: input.expiresAt ?? null,
      })
      .returning();

    return {
      token,
      tokenRecord: toTokenSummary(row),
    };
  });
}

export async function revokeAgentApiToken(tokenId: string) {
  return withAuthedOrgContext(async (tx) => {
    const [row] = await tx
      .update(agentApiTokens)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(agentApiTokens.id, tokenId), isNull(agentApiTokens.revokedAt)))
      .returning();

    if (!row) {
      throw new AuthorizationError("Agent API token not found.", 404);
    }

    return toTokenSummary(row);
  });
}

async function authenticateParsedAgentTokenInTx(
  tx: Tx,
  parsed: ParsedAgentToken,
  requiredScope: AgentApiTokenScope
) {
  const [row] = await tx
    .select()
    .from(agentApiTokens)
    .where(
      and(
        eq(agentApiTokens.id, parsed.tokenId),
        isNull(agentApiTokens.revokedAt)
      )
    )
    .limit(1);

  if (!row || !safeEqualHex(row.tokenHash, hashToken(parsed.token))) {
    throw new AuthorizationError("Invalid agent API token.", 401);
  }

  if (row.expiresAt && row.expiresAt <= new Date()) {
    throw new AuthorizationError("Agent API token has expired.", 401);
  }

  if (!row.scopes.includes(requiredScope)) {
    throw new AuthorizationError("Agent API token does not allow this action.", 403);
  }

  await tx
    .update(agentApiTokens)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(agentApiTokens.id, row.id));

  return {
    orgId: parsed.orgId,
    tokenId: row.id,
    scopes: row.scopes,
  };
}

export async function authenticateAgentBearerToken(
  token: string,
  requiredScope: AgentApiTokenScope
) {
  const parsed = parseAgentToken(token);
  if (!parsed) {
    throw new AuthorizationError("Invalid agent API token.", 401);
  }

  return withOrgContext(parsed.orgId, (tx) =>
    authenticateParsedAgentTokenInTx(tx, parsed, requiredScope)
  );
}

export function readBearerToken(headers: Headers) {
  const value = headers.get("authorization");
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1]?.trim() || null;
}
