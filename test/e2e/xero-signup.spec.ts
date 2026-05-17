import dotenv from "dotenv";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect, test } from "./fixtures";
import {
  account,
  integrationConnections,
  member,
  organization,
  session,
  user,
  xeroSignupIntents,
} from "../../lib/db/schema";
import { db } from "../../lib/db";
import {
  encryptXeroToken,
  resetXeroTokenEncryptionKeyForTests,
} from "../../lib/xero/token-crypto";
import { withOrgContext } from "../../lib/db/with-org-context";

dotenv.config({ path: ".env.local" });

const TEST_KEY = Buffer.from("xero-signup-test-key-32-bytes!!!").toString("base64");
const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "XeroSignupPassword123!";
const CONNECTED_SETTINGS_URL = "/settings?xero_signup=connected#integrations";

function setTestEncryptionKey() {
  process.env.XERO_TOKEN_ENCRYPTION_KEY = TEST_KEY;
  process.env.XERO_TOKEN_ENCRYPTION_KEY_ID = "test";
  resetXeroTokenEncryptionKeyForTests();
}

function hashClaimToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function seedIntent(params: {
  email: string;
  token: string;
  tenantId: string;
  tenantName?: string;
}) {
  setTestEncryptionKey();
  const accessToken = encryptXeroToken(`access-${params.token}`);
  const refreshToken = encryptXeroToken(`refresh-${params.token}`);
  const tenantName = params.tenantName ?? "Xero Signup Co";
  const [intent] = await db
    .insert(xeroSignupIntents)
    .values({
      email: params.email,
      name: "Xero Signup User",
      xeroUserId: `xero-user-${params.email}`,
      tenantId: params.tenantId,
      tenantName,
      authorizedTenants: [
        {
          tenantId: params.tenantId,
          tenantName,
        },
      ],
      accessTokenCiphertext: accessToken.ciphertext,
      refreshTokenCiphertext: refreshToken.ciphertext,
      tokenEncryptionKeyId: refreshToken.keyId,
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      claimTokenHash: hashClaimToken(params.token),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    })
    .returning({ id: xeroSignupIntents.id });

  expect(intent).toBeTruthy();
  return {
    id: intent.id,
    token: params.token,
  };
}

async function signUpWithPassword(email: string) {
  const response = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: BASE_URL,
    },
    body: JSON.stringify({
      email,
      name: "Existing Xero User",
      password: PASSWORD,
    }),
  });
  expect(response.status).toBe(200);
  const body = await response.json();

  return body.user.id as string;
}

async function markUserMfaEnrolled(email: string) {
  await db.update(user).set({ twoFactorEnabled: true }).where(eq(user.email, email));
}

async function createOrgForUser(userId: string, name: string) {
  const orgId = crypto.randomUUID();
  await db.insert(organization).values({
    id: orgId,
    name,
    slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
    createdAt: new Date(),
  });
  await db.insert(member).values({
    id: crypto.randomUUID(),
    organizationId: orgId,
    userId,
    role: "owner",
    createdAt: new Date(),
  });
  return orgId;
}

async function getXeroConnectionForOrg(orgId: string) {
  return withOrgContext(orgId, async (tx) => {
    const [connection] = await tx
      .select({ tenantId: integrationConnections.tenantId })
      .from(integrationConnections)
      .where(eq(integrationConnections.provider, "xero"));
    return connection ?? null;
  });
}

test.describe("Xero App Store signup", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("creates a passwordless owner account and connects Xero", async ({ page }) => {
    const run = Date.now();
    const email = `xero-new-${run}@example.com`;
    const token = `new-${run}`;
    const tenantId = `tenant-new-${run}`;
    const { id: intentId } = await seedIntent({ email, token, tenantId });

    await page.goto(`/api/auth/xero-signup/complete?intent=${intentId}&token=${token}`);
    await page.waitForURL("**/mfa-setup?next=**");
    const mfaUrl = new URL(page.url());
    expect(mfaUrl.searchParams.get("next")).toBe(CONNECTED_SETTINGS_URL);

    const [createdUser] = await db
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(eq(user.email, email));
    expect(createdUser).toBeTruthy();

    const credentialAccounts = await db
      .select({ id: account.id })
      .from(account)
      .where(
        and(eq(account.userId, createdUser.id), eq(account.providerId, "credential"))
      );
    expect(credentialAccounts).toHaveLength(0);

    const [createdSession] = await db
      .select({ activeOrganizationId: session.activeOrganizationId })
      .from(session)
      .where(eq(session.userId, createdUser.id));
    expect(createdSession.activeOrganizationId).toBeTruthy();

    const connection = await getXeroConnectionForOrg(
      createdSession.activeOrganizationId!
    );
    expect(connection?.tenantId).toBe(tenantId);

    const [claimedIntent] = await db
      .select({ status: xeroSignupIntents.status })
      .from(xeroSignupIntents)
      .where(eq(xeroSignupIntents.id, intentId));
    expect(claimedIntent.status).toBe("claimed");
  });

  test("requires an existing Ashicore user to sign in before linking", async ({ page }) => {
    const run = Date.now();
    const email = `xero-existing-${run}@example.com`;
    const token = `existing-${run}`;
    const tenantId = `tenant-existing-${run}`;
    const userId = await signUpWithPassword(email);
    const orgId = await createOrgForUser(userId, "Existing Xero Org");
    const { id: intentId } = await seedIntent({ email, token, tenantId });

    await page.goto(`/api/auth/xero-signup/link?intent=${intentId}&token=${token}`);
    await page.waitForURL("**/sign-in?callbackURL=**");

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Login" }).click();
    await page.waitForURL("**/xero/sign-up/error?reason=active_org_required");

    await markUserMfaEnrolled(email);
    await db
      .update(session)
      .set({ activeOrganizationId: orgId })
      .where(eq(session.userId, userId));

    await page.goto(`/api/auth/xero-signup/link?intent=${intentId}&token=${token}`);
    await page.waitForURL("**/settings?xero_signup=connected**");

    const connection = await getXeroConnectionForOrg(orgId);
    expect(connection?.tenantId).toBe(tenantId);
  });

  test("rejects expired or invalid signup intents", async ({ page }) => {
    const run = Date.now();
    const token = `expired-${run}`;
    const { id: intentId } = await seedIntent({
      email: `xero-expired-${run}@example.com`,
      token,
      tenantId: `tenant-expired-${run}`,
    });

    await db
      .update(xeroSignupIntents)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(xeroSignupIntents.claimTokenHash, hashClaimToken(token)));

    await page.goto(`/api/auth/xero-signup/complete?intent=${intentId}&token=${token}`);
    await page.waitForURL("**/xero/sign-up/error?reason=expired");
  });
});
