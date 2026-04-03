import dotenv from "dotenv";
import { and, eq } from "drizzle-orm";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { test, expect } from "./fixtures";
import {
  createCustomer,
  createItem,
  getBaseUrl,
  getOrgId,
  getUnitId,
  testFetch,
} from "../helpers/api";
import { extractFirstUrl, waitForOutboxEmail } from "../helpers/email-outbox";
import { member, salesOrders, user } from "../../lib/db/schema";

dotenv.config({ path: ".env.local" });

const authConnectionString =
  process.env.DATABASE_URL_APP || process.env.DATABASE_URL;
const authPool = new Pool({ connectionString: authConnectionString });
const authDb = drizzle(authPool);

const TEST_USER_EMAIL = "test-agent@erp-test.local";

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
      status: "draft",
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
        .set({ role: "viewer" })
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

  test("email change stays pending until the new address is verified", async ({ db }) => {
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

  test("confirmed sales order remains confirmed after auth guard attempts", async ({ db }) => {
    const [order] = await db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, orderId))
      .limit(1);

    expect(order?.status).toBe("confirmed");
  });
});
