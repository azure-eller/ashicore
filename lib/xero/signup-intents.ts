import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  integrationConnections,
  member,
  organization,
  user,
  xeroSignupIntents,
  type XeroSignupAuthorizedTenant,
} from "@/lib/db/schema";
import { withOrgContext } from "@/lib/db/with-org-context";
import { buildAssignedRoles } from "@/lib/authz";
import { ACCOUNTING_PROVIDER_XERO } from "@/lib/accounting/constants";
import { encryptXeroToken } from "./token-crypto";

const CLAIM_TOKEN_BYTES = 32;
const INTENT_TTL_MS = 30 * 60 * 1000;

export type XeroSignupIntent = typeof xeroSignupIntents.$inferSelect;

export type CreateXeroSignupIntentParams = {
  email: string;
  name: string;
  xeroUserId: string;
  tenantId: string;
  tenantName: string;
  authorizedTenants: XeroSignupAuthorizedTenant[];
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
};

export type PersistSignupConnectionResult =
  | { ok: true }
  | { ok: false; reason: "org_has_different_tenant" | "tenant_connected_elsewhere" };

export function hashXeroSignupClaimToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function buildXeroSignupName(params: {
  givenName?: string | null;
  familyName?: string | null;
  email: string;
}) {
  const name = [params.givenName, params.familyName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");

  return name || params.email;
}

export function buildOrganizationSlug(name: string) {
  const base = name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "");

  return base || "xero-organization";
}

export async function createXeroSignupIntent(
  params: CreateXeroSignupIntentParams
) {
  return createXeroSignupIntentWithToken({
    ...params,
    claimToken: randomBytes(CLAIM_TOKEN_BYTES).toString("base64url"),
  });
}

export async function createXeroSignupIntentWithToken(
  params: CreateXeroSignupIntentParams & { claimToken: string }
) {
  const claimToken = params.claimToken;
  const claimTokenHash = hashXeroSignupClaimToken(claimToken);
  const accessToken = encryptXeroToken(params.accessToken);
  const refreshToken = encryptXeroToken(params.refreshToken);

  const [intent] = await db
    .insert(xeroSignupIntents)
    .values({
      email: params.email.toLowerCase(),
      name: params.name,
      xeroUserId: params.xeroUserId,
      tenantId: params.tenantId,
      tenantName: params.tenantName,
      authorizedTenants: params.authorizedTenants,
      accessTokenCiphertext: accessToken.ciphertext,
      refreshTokenCiphertext: refreshToken.ciphertext,
      tokenEncryptionKeyId: refreshToken.keyId,
      tokenExpiresAt: params.expiresAt,
      claimTokenHash,
      expiresAt: new Date(Date.now() + INTENT_TTL_MS),
    })
    .returning({ id: xeroSignupIntents.id });

  if (!intent) {
    throw new Error("Failed to create Xero signup intent.");
  }

  return { id: intent.id, token: claimToken };
}

export async function findAshicoreUserByEmail(email: string) {
  const [row] = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(eq(user.email, email.toLowerCase()))
    .limit(1);

  return row ?? null;
}

export async function getValidXeroSignupIntent(params: {
  id: string;
  token: string;
}) {
  const [intent] = await db
    .select()
    .from(xeroSignupIntents)
    .where(
      and(
        eq(xeroSignupIntents.id, params.id),
        eq(xeroSignupIntents.claimTokenHash, hashXeroSignupClaimToken(params.token)),
        eq(xeroSignupIntents.status, "pending"),
        gt(xeroSignupIntents.expiresAt, new Date())
      )
    )
    .limit(1);

  return intent ?? null;
}

export async function markXeroSignupIntentClaimed(params: {
  id: string;
  userId: string;
  organizationId: string;
}) {
  await db
    .update(xeroSignupIntents)
    .set({
      status: "claimed",
      claimedUserId: params.userId,
      claimedOrganizationId: params.organizationId,
      claimedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(xeroSignupIntents.id, params.id));
}

async function createUniqueOrganizationSlug(name: string) {
  const base = buildOrganizationSlug(name);

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const [existing] = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.slug, candidate))
      .limit(1);

    if (!existing) return candidate;
  }

  return `${base}-${randomUUID().slice(0, 8)}`;
}

export async function createPasswordlessOwnerOrg(params: {
  userId: string;
  tenantName: string;
}) {
  const now = new Date();
  const organizationId = randomUUID();
  const memberId = randomUUID();
  const name = params.tenantName.trim() || "Xero Organization";
  const slug = await createUniqueOrganizationSlug(name);
  const assignedRoles = buildAssignedRoles("owner", {}).join(",");

  await db.transaction(async (tx) => {
    await tx.insert(organization).values({
      id: organizationId,
      name,
      slug,
      createdAt: now,
    });

    await tx.insert(member).values({
      id: memberId,
      organizationId,
      userId: params.userId,
      role: assignedRoles,
      createdAt: now,
    });
  });

  return { id: organizationId, name, slug };
}

export async function persistXeroSignupConnection(
  orgId: string,
  intent: XeroSignupIntent
): Promise<PersistSignupConnectionResult> {
  try {
    return await withOrgContext(orgId, async (tx) => {
      const [existing] = await tx
        .select({
          tenantId: integrationConnections.tenantId,
        })
        .from(integrationConnections)
        .where(eq(integrationConnections.provider, ACCOUNTING_PROVIDER_XERO))
        .for("update");

      if (existing && existing.tenantId !== intent.tenantId) {
        return { ok: false, reason: "org_has_different_tenant" };
      }

      await tx
        .insert(integrationConnections)
        .values({
          organizationId: orgId,
          provider: ACCOUNTING_PROVIDER_XERO,
          tenantId: intent.tenantId,
          tenantName: intent.tenantName,
          authorizedTenants: intent.authorizedTenants,
          accessTokenCiphertext: intent.accessTokenCiphertext,
          refreshTokenCiphertext: intent.refreshTokenCiphertext,
          tokenEncryptionKeyId: intent.tokenEncryptionKeyId,
          tokenExpiresAt: intent.tokenExpiresAt,
        })
        .onConflictDoUpdate({
          target: [
            integrationConnections.organizationId,
            integrationConnections.provider,
          ],
          set: {
            tenantId: intent.tenantId,
            tenantName: intent.tenantName,
            authorizedTenants: intent.authorizedTenants,
            accessTokenCiphertext: intent.accessTokenCiphertext,
            refreshTokenCiphertext: intent.refreshTokenCiphertext,
            tokenEncryptionKeyId: intent.tokenEncryptionKeyId,
            tokenExpiresAt: intent.tokenExpiresAt,
            updatedAt: new Date(),
          },
        });

      return { ok: true };
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error != null &&
      "code" in error &&
      error.code === "23505"
    ) {
      return { ok: false, reason: "tenant_connected_elsewhere" };
    }

    throw error;
  }
}
