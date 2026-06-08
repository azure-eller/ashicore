import { createHash, randomBytes, randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { and, eq } from "drizzle-orm";
import { test, expect } from "./fixtures";
import {
  createCustomer,
  createItem,
  getBaseUrl,
  getOrgId,
  getSessionCookie,
  getUnitId,
  testFetch,
} from "../helpers/api";
import { extractFirstUrl, waitForOutboxEmail } from "../helpers/email-outbox";
import { TEST_ACCOUNT_EMAIL } from "../helpers/test-account";
import { invitation, member, salesOrders, user } from "../../lib/db/schema";

dotenv.config({ path: ".env.local" });

const authConnectionString =
  process.env.DATABASE_URL_APP || process.env.DATABASE_URL;
const isNeon = authConnectionString?.includes(".neon.tech") ?? false;

function createAuthDb() {
  if (isNeon) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require("@neondatabase/serverless") as typeof import("@neondatabase/serverless");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { drizzle } = require("drizzle-orm/neon-serverless") as typeof import("drizzle-orm/neon-serverless");
    return drizzle(new Pool({ connectionString: authConnectionString }));
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require("pg") as typeof import("pg");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require("drizzle-orm/node-postgres") as typeof import("drizzle-orm/node-postgres");
  return drizzle(new Pool({ connectionString: authConnectionString }));
}

const authDb = createAuthDb();

const TEST_USER_EMAIL = TEST_ACCOUNT_EMAIL;
const SETTINGS_ADMIN_ROLE =
  "access:matrix,member,settings:admin,sales:read";
const SALES_ONLY_ROLE = "access:matrix,member,sales:read";
const MANUFACTURING_ONLY_ROLE = "access:matrix,member,manufacturing:read";
const FULL_ADMIN_ROLE =
  "access:matrix,member,settings:admin,inventory:admin,sales:admin,manufacturing:admin,purchasing:admin";

async function createConfirmedSalesOrder(payload: {
  customerId: string;
  itemId: string;
  quantity: string;
  unitPrice: string;
}) {
  const createResponse = await testFetch("/api/sales-orders", {
    method: "POST",
    body: JSON.stringify({
      customerId: payload.customerId,
      status: "open",
      orderDate: "2026-04-15",
      shipDate: "2026-04-15",
      requestedDate: null,
      notes: null,
      lines: [
        {
          itemId: payload.itemId,
          quantity: payload.quantity,
          unitPrice: payload.unitPrice,
        },
      ],
      confirmOversell: false,
    }),
  });
  const createdOrder = await createResponse.json();

  expect(createResponse.status).toBe(201);

  const confirmResponse = await testFetch(`/api/sales-orders/${createdOrder.id}/confirm`, {
    method: "POST",
    body: JSON.stringify({ confirmOversell: true }),
  });
  expect(confirmResponse.status).toBe(200);

  return createdOrder.id as string;
}

async function publicAuthFetch(path: string, body: Record<string, unknown>) {
  return fetch(`${getBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: getBaseUrl(),
    },
    body: JSON.stringify(body),
    redirect: "manual",
  });
}

async function getTestMembership() {
  const [testUser] = await authDb
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, TEST_USER_EMAIL))
    .limit(1);
  expect(testUser).toBeTruthy();

  const [membership] = await authDb
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(
      and(eq(member.userId, testUser.id), eq(member.organizationId, getOrgId()))
    )
    .limit(1);
  expect(membership).toBeTruthy();

  return membership;
}

async function createAuthMember(role: string) {
  const userId = randomUUID();
  const memberId = randomUUID();
  await authDb.insert(user).values({
    id: userId,
    name: "Auth Guard Target",
    email: `auth-guard-target-${memberId}@example.com`,
    emailVerified: true,
    twoFactorEnabled: true,
  });
  await authDb.insert(member).values({
    id: memberId,
    organizationId: getOrgId(),
    userId,
    role,
    createdAt: new Date(),
  });
  return memberId;
}

function createPkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function exchangeMcpCode(args: {
  code: string;
  verifier: string;
  redirectUri: string;
}) {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    client_id: "auth-security-test",
    redirect_uri: args.redirectUri,
    code_verifier: args.verifier,
  });

  return fetch(`${getBaseUrl()}/api/agent/mcp/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: getBaseUrl(),
      Cookie: getSessionCookie(),
    },
    body: form,
    redirect: "manual",
  });
}

async function refreshMcpToken(refreshToken: string) {
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: "auth-security-test",
  });

  return fetch(`${getBaseUrl()}/api/agent/mcp/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: getBaseUrl(),
      Cookie: getSessionCookie(),
    },
    body: form,
    redirect: "manual",
  });
}

test.describe("Auth and security regressions", () => {
  test.describe.configure({ mode: "serial" });

  const run = Date.now();
  const unitId = getUnitId();
  const materialName = `Auth Guard Material ${run}`;
  const productName = `Auth Guard Product ${run}`;
  const customerName = `Auth Guard Customer ${run}`;
  let orderId = "";

  test("creates confirmed sales fixtures for manufacturing guard coverage", async () => {
    const materialResult = await createItem({
      name: materialName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `AUTH-MAT-${run}`,
      category: `Auth ${run}`,
      description: "Material used for auth guard coverage",
      defaultPurchasePrice: "1.50",
      defaultSellingPrice: null,
      stock: "10",
      safetyStock: "0",
      bom: [],
    });
    expect(materialResult.status).toBe(201);

    const productResult = await createItem({
      name: productName,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `AUTH-PROD-${run}`,
      category: `Auth ${run}`,
      description: "BOM-backed product used for manufacturing auth coverage",
      defaultPurchasePrice: null,
      defaultSellingPrice: "15.00",
      sellable: true,
      stock: "0",
      safetyStock: "0",
      bom: [
        {
          componentId: materialResult.body.id,
          quantity: "1",
        },
      ],
    });
    expect(productResult.status).toBe(201);

    const customerResult = await createCustomer({ name: customerName });
    expect(customerResult.status).toBe(201);

    orderId = await createConfirmedSalesOrder({
      customerId: customerResult.body.id,
      itemId: productResult.body.id,
      quantity: "2",
      unitPrice: "15.00",
    });
  });

  test("manufacturing creation requires manufacturing write access", async () => {
    const [testUser] = await authDb
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, TEST_USER_EMAIL))
      .limit(1);

    expect(testUser).toBeTruthy();

    const [membership] = await authDb
      .select({ id: member.id, role: member.role })
      .from(member)
      .where(
        and(eq(member.userId, testUser.id), eq(member.organizationId, getOrgId()))
      )
      .limit(1);

    expect(membership).toBeTruthy();

    const originalRole = membership.role;

    try {
      await authDb
        .update(member)
        .set({ role: "access:matrix,member,settings:read" })
        .where(eq(member.id, membership.id));

      const response = await testFetch(
        `/api/sales-orders/${orderId}/manufacturing-orders`,
        {
          method: "POST",
          body: JSON.stringify({
            plannedDate: null,
            notes: null,
          }),
        }
      );
      const body = await response.json().catch(() => null);

      expect(response.status).toBe(403);
      expect(body?.error).toBe("You do not have permission to update manufacturing.");
    } finally {
      await authDb
        .update(member)
        .set({ role: originalRole })
        .where(eq(member.id, membership.id));
    }
  });

  test("native Better Auth organization endpoints enforce app team ceilings", async () => {
    const actor = await getTestMembership();
    const targetMemberId = await createAuthMember(SALES_ONLY_ROLE);
    const inviteEmail = `native-ceiling-${run}@example.com`;

    try {
      await authDb
        .update(member)
        .set({ role: SETTINGS_ADMIN_ROLE })
        .where(eq(member.id, actor.id));

      const updateResponse = await testFetch("/api/auth/organization/update-member-role", {
        method: "POST",
        body: JSON.stringify({
          memberId: targetMemberId,
          role: FULL_ADMIN_ROLE,
        }),
      });
      expect(updateResponse.status).toBe(403);

      const inviteResponse = await testFetch("/api/auth/organization/invite-member", {
        method: "POST",
        body: JSON.stringify({
          email: inviteEmail,
          role: FULL_ADMIN_ROLE,
        }),
      });
      expect(inviteResponse.status).toBe(403);

      const [target] = await authDb
        .select({ role: member.role })
        .from(member)
        .where(eq(member.id, targetMemberId))
        .limit(1);
      expect(target.role).toBe(SALES_ONLY_ROLE);

      const inviteRows = await authDb
        .select({ id: invitation.id })
        .from(invitation)
        .where(
          and(
            eq(invitation.organizationId, getOrgId()),
            eq(invitation.email, inviteEmail)
          )
        );
      expect(inviteRows).toHaveLength(0);
    } finally {
      await authDb
        .update(member)
        .set({ role: actor.role })
        .where(eq(member.id, actor.id));
    }
  });

  test("MCP OAuth planning grants are checked at grant and refresh time", async () => {
    const actor = await getTestMembership();
    const redirectUri = "http://localhost/callback";
    const { verifier, challenge } = createPkcePair();

    try {
      const allowParams = new URLSearchParams({
        response_type: "code",
        client_id: "auth-security-test",
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: "allowed",
      });
      const allowResponse = await testFetch(
        `/api/agent/mcp/oauth/authorize?${allowParams}`
      );
      expect(allowResponse.status).toBe(307);
      const code = new URL(allowResponse.headers.get("location") ?? "").searchParams.get(
        "code"
      );
      expect(code).toBeTruthy();

      const tokenResponse = await exchangeMcpCode({
        code: code!,
        verifier,
        redirectUri,
      });
      expect(tokenResponse.status).toBe(200);
      const tokenBody = await tokenResponse.json();
      expect(tokenBody.refresh_token).toBeTruthy();

      await authDb
        .update(member)
        .set({ role: SALES_ONLY_ROLE })
        .where(eq(member.id, actor.id));

      const denyParams = new URLSearchParams({
        response_type: "code",
        client_id: "auth-security-test",
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: "denied",
      });
      const denyResponse = await testFetch(
        `/api/agent/mcp/oauth/authorize?${denyParams}`
      );
      const denyLocation = denyResponse.headers.get("location") ?? "";
      expect(denyResponse.status).toBe(307);
      expect(denyLocation).toContain("error=access_denied");
      expect(denyLocation).not.toContain("code=");

      const refreshResponse = await refreshMcpToken(tokenBody.refresh_token);
      expect(refreshResponse.status).toBe(401);
    } finally {
      await authDb
        .update(member)
        .set({ role: actor.role })
        .where(eq(member.id, actor.id));
    }
  });

  test("observability performance targets enforce module read access", async () => {
    const actor = await getTestMembership();

    try {
      await authDb
        .update(member)
        .set({ role: MANUFACTURING_ONLY_ROLE })
        .where(eq(member.id, actor.id));

      const response = await testFetch(
        "/api/observability/performance?target=sales-customers"
      );

      expect(response.status).toBe(403);
    } finally {
      await authDb
        .update(member)
        .set({ role: actor.role })
        .where(eq(member.id, actor.id));
    }
  });

  test.fixme("email change stays pending until the new address is verified", async ({ db }) => {
    const emailRequestedAt = Date.now();
    const pendingEmail = `pending-email-${run}@example.com`;

    const [beforeChange] = await db
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(eq(user.email, TEST_USER_EMAIL))
      .limit(1);

    expect(beforeChange).toBeTruthy();

    const response = await testFetch("/api/account/email", {
      method: "POST",
      body: JSON.stringify({ newEmail: pendingEmail }),
    });

    expect(response.status).toBe(200);

    const emailMessage = await waitForOutboxEmail({
      since: emailRequestedAt,
      tag: "email-verification",
      to: pendingEmail,
    });

    expect(emailMessage.subject).toContain("Confirm your email address");
    expect(extractFirstUrl(emailMessage.text)).toContain("/api/auth/verify-email");

    const [afterChange] = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, beforeChange.id))
      .limit(1);

    expect(afterChange.email).toBe(TEST_USER_EMAIL);
  });

  test("password reset sends a link and accepts the new password", async ({ db }) => {
    const email = `password-reset-${run}@example.com`;
    const originalPassword = "OriginalPassword123!";
    const newPassword = "UpdatedPassword123!";

    const signUpResponse = await publicAuthFetch("/api/auth/sign-up/email", {
      name: `Password Reset ${run}`,
      email,
      password: originalPassword,
    });

    expect(signUpResponse.ok).toBe(true);

    const [createdUser] = await db
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(eq(user.email, email))
      .limit(1);

    expect(createdUser?.email).toBe(email);

    const resetRequestedAt = Date.now();
    const requestResetResponse = await publicAuthFetch(
      "/api/auth/request-password-reset",
      {
        email,
        redirectTo: `${getBaseUrl()}/reset-password`,
      }
    );

    expect(requestResetResponse.ok).toBe(true);

    const resetEmail = await waitForOutboxEmail({
      since: resetRequestedAt,
      tag: "password-reset",
      to: email,
    });
    const resetUrl = extractFirstUrl(resetEmail.text);
    const token = new URL(resetUrl).pathname.split("/").at(-1) ?? null;

    expect(token).toBeTruthy();

    const resetResponse = await publicAuthFetch("/api/auth/reset-password", {
      token,
      newPassword,
    });

    expect(resetResponse.ok).toBe(true);

    const signInWithOldPassword = await publicAuthFetch("/api/auth/sign-in/email", {
      email,
      password: originalPassword,
    });
    expect(signInWithOldPassword.ok).toBe(false);

    const signInWithNewPassword = await publicAuthFetch("/api/auth/sign-in/email", {
      email,
      password: newPassword,
    });
    expect(signInWithNewPassword.ok).toBe(true);

    const [persistedUser] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email))
      .limit(1);
    expect(persistedUser?.id).toBe(createdUser.id);
  });

  test("sales order stays open after auth guard attempts", async ({ db }) => {
    const [order] = await db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, orderId))
      .limit(1);

    expect(order?.status).toBe("open");
  });
});
