import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, inArray, lt, or } from "drizzle-orm";
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
// Keep claimed/expired rows around long enough to debug a failed signup,
// then delete them — they only carry stale encrypted tokens and tenant info.
const RETENTION_AFTER_FINAL_STATE_MS = 7 * 24 * 60 * 60 * 1000;
// A consuming intent that hasn't transitioned in 15 minutes is a crashed
// request; reset it so the user can retry within the original 30-minute TTL.
const CONSUMING_REVERT_AFTER_MS = 15 * 60 * 1000;

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

// Two concurrent callers cannot both win the consuming claim. The intent
// flips pending → consuming in a single conditional update; only the request
// whose RETURNING set is non-empty proceeds with the user/org side effects.
// Crashed consumers are left in 'consuming' and later either finalised or
// reverted by `cleanupStuckXeroSignupConsuming`.
export async function startConsumingXeroSignupIntent(params: {
  id: string;
  token: string;
}) {
  const [intent] = await db
    .update(xeroSignupIntents)
    .set({ status: "consuming", updatedAt: new Date() })
    .where(
      and(
        eq(xeroSignupIntents.id, params.id),
        eq(xeroSignupIntents.claimTokenHash, hashXeroSignupClaimToken(params.token)),
        eq(xeroSignupIntents.status, "pending"),
        gt(xeroSignupIntents.expiresAt, new Date())
      )
    )
    .returning();

  return intent ?? null;
}

export async function revertConsumingXeroSignupIntentToPending(id: string) {
  await db
    .update(xeroSignupIntents)
    .set({ status: "pending", updatedAt: new Date() })
    .where(
      and(
        eq(xeroSignupIntents.id, id),
        eq(xeroSignupIntents.status, "consuming")
      )
    );
}

export async function cleanupXeroSignupIntents(now = new Date()) {
  // 1) Revive consuming rows that look crashed so the user can try again.
  const revertCutoff = new Date(now.getTime() - CONSUMING_REVERT_AFTER_MS);
  const revivedRows = await db
    .update(xeroSignupIntents)
    .set({ status: "pending", updatedAt: now })
    .where(
      and(
        eq(xeroSignupIntents.status, "consuming"),
        lt(xeroSignupIntents.updatedAt, revertCutoff),
        gt(xeroSignupIntents.expiresAt, now)
      )
    )
    .returning({ id: xeroSignupIntents.id });

  // 2) Delete claimed/expired rows past the retention window. Pending and
  //    fresh consuming rows are kept for the user to consume or for step 1.
  const deletionCutoff = new Date(now.getTime() - RETENTION_AFTER_FINAL_STATE_MS);
  const deletedRows = await db
    .delete(xeroSignupIntents)
    .where(
      or(
        and(
          eq(xeroSignupIntents.status, "claimed"),
          lt(xeroSignupIntents.updatedAt, deletionCutoff)
        ),
        and(
          inArray(xeroSignupIntents.status, ["pending", "consuming"]),
          lt(xeroSignupIntents.expiresAt, deletionCutoff)
        )
      )
    )
    .returning({ id: xeroSignupIntents.id });

  return {
    revivedConsumingCount: revivedRows.length,
    deletedRowCount: deletedRows.length,
  };
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
      // Re-read the intent row inside this transaction with FOR UPDATE so
      // the operator-run token rotation can't change the ciphertext under
      // us between the caller's startConsumingXeroSignupIntent() and the
      // INSERT below. The in-memory `intent` argument is treated as a
      // routing hint (its id) — the source of truth for token material is
      // the locked row we read here. If rotation already updated the row,
      // we get the new-key ciphertext; if rotation runs after this select,
      // it waits on this lock and never sees the old-key row again.
      const [freshIntent] = await tx
        .select({
          tenantId: xeroSignupIntents.tenantId,
          tenantName: xeroSignupIntents.tenantName,
          authorizedTenants: xeroSignupIntents.authorizedTenants,
          accessTokenCiphertext: xeroSignupIntents.accessTokenCiphertext,
          refreshTokenCiphertext: xeroSignupIntents.refreshTokenCiphertext,
          tokenEncryptionKeyId: xeroSignupIntents.tokenEncryptionKeyId,
          tokenExpiresAt: xeroSignupIntents.tokenExpiresAt,
        })
        .from(xeroSignupIntents)
        .where(eq(xeroSignupIntents.id, intent.id))
        .for("update");

      if (!freshIntent) {
        return { ok: false, reason: "org_has_different_tenant" };
      }

      const [existing] = await tx
        .select({
          tenantId: integrationConnections.tenantId,
        })
        .from(integrationConnections)
        .where(eq(integrationConnections.provider, ACCOUNTING_PROVIDER_XERO))
        .for("update");

      if (existing && existing.tenantId !== freshIntent.tenantId) {
        return { ok: false, reason: "org_has_different_tenant" };
      }

      await tx
        .insert(integrationConnections)
        .values({
          organizationId: orgId,
          provider: ACCOUNTING_PROVIDER_XERO,
          tenantId: freshIntent.tenantId,
          tenantName: freshIntent.tenantName,
          authorizedTenants: freshIntent.authorizedTenants,
          accessTokenCiphertext: freshIntent.accessTokenCiphertext,
          refreshTokenCiphertext: freshIntent.refreshTokenCiphertext,
          tokenEncryptionKeyId: freshIntent.tokenEncryptionKeyId,
          tokenExpiresAt: freshIntent.tokenExpiresAt,
        })
        .onConflictDoUpdate({
          target: [
            integrationConnections.organizationId,
            integrationConnections.provider,
          ],
          set: {
            tenantId: freshIntent.tenantId,
            tenantName: freshIntent.tenantName,
            authorizedTenants: freshIntent.authorizedTenants,
            accessTokenCiphertext: freshIntent.accessTokenCiphertext,
            refreshTokenCiphertext: freshIntent.refreshTokenCiphertext,
            tokenEncryptionKeyId: freshIntent.tokenEncryptionKeyId,
            tokenExpiresAt: freshIntent.tokenExpiresAt,
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
