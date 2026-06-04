import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { Pool as PgPool } from "pg";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { and, eq, inArray } from "drizzle-orm";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import { test, expect, type TestDb } from "../fixtures";
import {
  createItem,
  createPurchaseOrder,
  createSupplier,
  getBaseUrl,
  getOrgId,
  getUnitId,
  receivePurchaseOrder,
  submitPurchaseOrder,
  testFetch,
} from "../../helpers/api";
import {
  accountingDocumentSyncs,
  integrationConnections,
  member,
  purchaseOrderLines,
  session as authSession,
  user,
} from "../../../lib/db/schema";

dotenv.config({ path: ".env.local" });

const authConnectionString =
  process.env.DATABASE_URL_APP || process.env.DATABASE_URL;
const isNeon = authConnectionString?.includes(".neon.tech") ?? false;

function createAuthDb() {
  if (isNeon) {
    return drizzleNeon(new NeonPool({ connectionString: authConnectionString }));
  }

  return drizzlePg(new PgPool({ connectionString: authConnectionString }));
}

const authDb = createAuthDb();

function extractSessionCookie(response: Response) {
  const setCookieHeaders = response.headers.getSetCookie?.() ?? [];
  for (const header of setCookieHeaders) {
    if (header.startsWith("better-auth.session_token=")) {
      return header.split(";")[0];
    }
  }

  const fallback = response.headers.get("set-cookie");
  if (fallback?.startsWith("better-auth.session_token=")) {
    return fallback.split(";")[0];
  }

  return null;
}

function sessionTokenFromCookie(cookie: string) {
  const rawValue = cookie.split("=").slice(1).join("=");
  return decodeURIComponent(rawValue).split(".")[0] || null;
}

async function createPurchasingReadOnlyCookie() {
  const baseUrl = getBaseUrl();
  const email = `fast-purchasing-read-${randomUUID()}@example.com`;
  const signUp = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
    },
    body: JSON.stringify({
      name: "Purchasing Read Only",
      email,
      password: `TestPassword-${randomUUID()}!`,
    }),
    redirect: "manual",
  });
  expect(signUp.status, await signUp.text()).toBeLessThan(400);

  const cookie = extractSessionCookie(signUp);
  expect(cookie).toBeTruthy();

  const token = sessionTokenFromCookie(cookie!);
  expect(token).toBeTruthy();

  const [createdUser] = await authDb
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  expect(createdUser).toBeTruthy();

  await authDb.insert(member).values({
    id: randomUUID(),
    organizationId: getOrgId(),
    userId: createdUser.id,
    role: "access:matrix,member,purchasing:read",
    createdAt: new Date(),
  });
  await authDb
    .update(authSession)
    .set({ activeOrganizationId: getOrgId(), updatedAt: new Date() })
    .where(eq(authSession.token, token!));

  return cookie!;
}

async function testFetchWithCookie(
  cookie: string,
  path: string,
  options: RequestInit = {},
) {
  const baseUrl = getBaseUrl();
  const method = (options.method ?? "GET").toUpperCase();
  const headers =
    method === "GET" || method === "HEAD"
      ? new Headers(options.headers)
      : createIdempotencyHeaders(`test:${method}:${path}:${randomUUID()}`, options.headers);

  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      Cookie: cookie,
      ...Object.fromEntries(headers.entries()),
    },
  });
}
const ACCOUNTING_DOCUMENT_PURCHASE_BILL = "purchase_bill";
const ACCOUNTING_PROVIDER_XERO = "xero";
const ACCOUNTING_PROVIDER_QUICKBOOKS = "quickbooks";

function billPayload(options: { confirmAdditionalCostsOmitted?: boolean } = {}) {
  return {
    invoiceNumber: `BILL-GATE-${Date.now()}`,
    billDate: "2026-05-27",
    dueDate: "2026-05-27",
    reference: null,
    accountingPurchaseAccountCode: "500",
    ...(options.confirmAdditionalCostsOmitted
      ? { confirmAdditionalCostsOmitted: true }
      : {}),
  };
}

function expectBillAttemptReachedXeroBoundary(
  status: number,
  body: { error?: string; status?: string; xeroBillNumber?: string },
) {
  if (status === 200) {
    expect(body.status).toBe("pushed");
    expect(body.xeroBillNumber).toBeTruthy();
    return;
  }

  expect(status).toBe(409);
  expect(body.error).toBe(
    "Connect an accounting provider before creating supplier bills.",
  );
}

async function createMaterialAndSupplier(ts: number) {
  const material = await createItem({
    itemType: "material",
    name: `Bill Gate Material ${ts}`,
    unitDefinitionId: getUnitId(),
    sku: `BILL-GATE-${ts}`,
    category: `Bill Gates ${ts}`,
    description: null,
    defaultPurchasePrice: "4.00",
    defaultSellingPrice: null,
    stock: "0",
    safetyStock: "0",
    bom: [],
  });
  expect(material.status).toBe(201);

  const supplier = await createSupplier({ name: `Bill Gate Supplier ${ts}` });
  expect(supplier.status).toBe(201);

  return { materialId: material.body.id as string, supplierId: supplier.body.id as string };
}

async function createReceivedPurchaseOrder(ts: number) {
  const { materialId, supplierId } = await createMaterialAndSupplier(ts);
  const order = await createPurchaseOrder({
    supplierId,
    expectedDate: "2026-05-27",
    lines: [{ itemId: materialId, quantityOrdered: "5", unitCost: "4.00" }],
  });
  expect(order.status).toBe(201);
  expect((await submitPurchaseOrder(order.body.id)).status).toBe(200);

  return order.body.id as string;
}

async function withNoAccountingConnection<T>(db: TestDb, fn: () => Promise<T>) {
  const existing = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organizationId, getOrgId()),
        inArray(integrationConnections.provider, [
          ACCOUNTING_PROVIDER_XERO,
          ACCOUNTING_PROVIDER_QUICKBOOKS,
        ]),
      ),
    );

  await db
    .delete(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organizationId, getOrgId()),
        inArray(integrationConnections.provider, [
          ACCOUNTING_PROVIDER_XERO,
          ACCOUNTING_PROVIDER_QUICKBOOKS,
        ]),
      ),
    );

  try {
    return await fn();
  } finally {
    if (existing.length > 0) {
      await db.insert(integrationConnections).values(existing);
    }
  }
}

async function receiveOrderLine(db: TestDb, orderId: string) {
  const [line] = await db
    .select({ id: purchaseOrderLines.id })
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.purchaseOrderId, orderId));
  expect(line).toBeTruthy();

  const receipt = await receivePurchaseOrder(orderId, {
    lines: [{ lineId: line.id, quantityReceived: "5" }],
  });
  expect(receipt.status).toBe(200);
}

async function withOnlyQuickBooksConnection<T>(
  db: TestDb,
  fn: () => Promise<T>,
) {
  const existing = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organizationId, getOrgId()),
        inArray(integrationConnections.provider, [
          ACCOUNTING_PROVIDER_XERO,
          ACCOUNTING_PROVIDER_QUICKBOOKS,
        ]),
      ),
    );

  await db
    .delete(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organizationId, getOrgId()),
        inArray(integrationConnections.provider, [
          ACCOUNTING_PROVIDER_XERO,
          ACCOUNTING_PROVIDER_QUICKBOOKS,
        ]),
      ),
    );
  await db.insert(integrationConnections).values({
    organizationId: getOrgId(),
    provider: ACCOUNTING_PROVIDER_QUICKBOOKS,
    tenantId: `test-qb-tenant-${randomUUID()}`,
    tenantName: "Test QuickBooks",
    accessTokenCiphertext: "test-access",
    refreshTokenCiphertext: "test-refresh",
    tokenEncryptionKeyId: "test-key",
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    defaultAccountCode: "QB-SALES",
    purchaseOrderDefaultAccountCode: "QB-EXPENSE",
  });

  try {
    return await fn();
  } finally {
    await db
      .delete(integrationConnections)
      .where(
        and(
          eq(integrationConnections.organizationId, getOrgId()),
          inArray(integrationConnections.provider, [
            ACCOUNTING_PROVIDER_XERO,
            ACCOUNTING_PROVIDER_QUICKBOOKS,
          ]),
        ),
      );
    if (existing.length > 0) {
      await db.insert(integrationConnections).values(existing);
    }
  }
}

async function withOnlyXeroConnection<T>(db: TestDb, fn: () => Promise<T>) {
  const existing = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organizationId, getOrgId()),
        inArray(integrationConnections.provider, [
          ACCOUNTING_PROVIDER_XERO,
          ACCOUNTING_PROVIDER_QUICKBOOKS,
        ]),
      ),
    );

  await db
    .delete(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organizationId, getOrgId()),
        inArray(integrationConnections.provider, [
          ACCOUNTING_PROVIDER_XERO,
          ACCOUNTING_PROVIDER_QUICKBOOKS,
        ]),
      ),
    );
  await db.insert(integrationConnections).values({
    organizationId: getOrgId(),
    provider: ACCOUNTING_PROVIDER_XERO,
    tenantId: `test-xero-tenant-${randomUUID()}`,
    tenantName: "Test Xero",
    accessTokenCiphertext: "test-access",
    refreshTokenCiphertext: "test-refresh",
    tokenEncryptionKeyId: "test-key",
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    defaultAccountCode: "400",
    purchaseOrderDefaultAccountCode: "500",
  });

  try {
    return await fn();
  } finally {
    await db
      .delete(integrationConnections)
      .where(
        and(
          eq(integrationConnections.organizationId, getOrgId()),
          inArray(integrationConnections.provider, [
            ACCOUNTING_PROVIDER_XERO,
            ACCOUNTING_PROVIDER_QUICKBOOKS,
          ]),
        ),
      );
    if (existing.length > 0) {
      await db.insert(integrationConnections).values(existing);
    }
  }
}

test.describe("Xero purchase bill gates", () => {
  test("does not block submitted POs before receipt", async ({ db }) => {
    await withNoAccountingConnection(db, async () => {
      const ts = Date.now();
      const { materialId, supplierId } = await createMaterialAndSupplier(ts);
      const order = await createPurchaseOrder({
        supplierId,
        expectedDate: "2026-05-27",
        lines: [{ itemId: materialId, quantityOrdered: "5", unitCost: "4.00" }],
      });
      expect(order.status).toBe(201);
      expect((await submitPurchaseOrder(order.body.id)).status).toBe(200);

      const response = await testFetch(
        `/api/purchase-orders/${order.body.id}/accounting-bill`,
        {
          method: "POST",
          body: JSON.stringify(
            billPayload({ confirmAdditionalCostsOmitted: true }),
          ),
        },
      );
      const body = await response.json();

      expectBillAttemptReachedXeroBoundary(response.status, body);
    });
  });

  test("blocks bill creation for draft purchase orders", async ({ db }) => {
    await withOnlyXeroConnection(db, async () => {
      const ts = Date.now();
      const { materialId, supplierId } = await createMaterialAndSupplier(ts);
      const order = await createPurchaseOrder({
        supplierId,
        expectedDate: "2026-05-27",
        lines: [{ itemId: materialId, quantityOrdered: "5", unitCost: "4.00" }],
      });
      expect(order.status).toBe(201);

      const response = await testFetch(
        `/api/purchase-orders/${order.body.id}/accounting-bill`,
        { method: "POST", body: JSON.stringify(billPayload()) },
      );
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.error).toBe(
        "Submit the purchase order before creating a Xero bill.",
      );
    });
  });

  test("requires confirmation when additional costs will be omitted", async ({ db }) => {
    await withOnlyXeroConnection(db, async () => {
      const ts = Date.now();
      const { materialId, supplierId } = await createMaterialAndSupplier(ts);
      const orderResponse = await testFetch("/api/purchase-orders", {
        method: "POST",
        body: JSON.stringify({
          supplierId,
          expectedDate: "2026-05-27",
          notes: null,
          lines: [{ itemId: materialId, quantityOrdered: "5", unitCost: "4.00" }],
          additionalCosts: [
            {
              costType: "shipping",
              reference: "Freight",
              distributionMethod: "not_distributed",
              accountingPurchaseAccountCode: null,
              amount: "12.00",
            },
          ],
        }),
      });
      const order = await orderResponse.json();
      expect(orderResponse.status).toBe(201);
      expect((await submitPurchaseOrder(order.id)).status).toBe(200);

      const [line] = await db
        .select({ id: purchaseOrderLines.id })
        .from(purchaseOrderLines)
        .where(eq(purchaseOrderLines.purchaseOrderId, order.id));
      expect(line).toBeTruthy();

      const receipt = await receivePurchaseOrder(order.id, {
        lines: [{ lineId: line.id, quantityReceived: "5" }],
      });
      expect(receipt.status).toBe(200);

      const response = await testFetch(
        `/api/purchase-orders/${order.id}/accounting-bill`,
        { method: "POST", body: JSON.stringify(billPayload()) },
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(body.error).toBe(
        "Confirm that additional costs will be added manually in Xero.",
      );
    });
  });

  test("blocks bill creation for cancelled purchase orders", async ({ db }) => {
    await withOnlyXeroConnection(db, async () => {
      const ts = Date.now();
      const { materialId, supplierId } = await createMaterialAndSupplier(ts);
      const order = await createPurchaseOrder({
        supplierId,
        expectedDate: "2026-05-27",
        lines: [{ itemId: materialId, quantityOrdered: "5", unitCost: "4.00" }],
      });
      expect(order.status).toBe(201);

      const cancelResponse = await testFetch(
        `/api/purchase-orders/${order.body.id}/status`,
        { method: "PATCH", body: JSON.stringify({ status: "cancelled" }) },
      );
      expect(cancelResponse.status).toBe(200);

      const response = await testFetch(
        `/api/purchase-orders/${order.body.id}/accounting-bill`,
        { method: "POST", body: JSON.stringify(billPayload()) },
      );
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.error).toBe("Cancelled purchase orders cannot be billed.");
    });
  });

  test("blocks retry while a bill sync is recently pending", async ({ db }) => {
    await withOnlyXeroConnection(db, async () => {
      const ts = Date.now();
      const orderId = await createReceivedPurchaseOrder(ts);
      await receiveOrderLine(db, orderId);

      await db.insert(accountingDocumentSyncs).values({
        organizationId: getOrgId(),
        provider: ACCOUNTING_PROVIDER_XERO,
        documentType: ACCOUNTING_DOCUMENT_PURCHASE_BILL,
        documentId: orderId,
        pushStatus: "pending",
        lastPushAttemptAt: new Date(),
      });

      const response = await testFetch(
        `/api/purchase-orders/${orderId}/accounting-bill`,
        {
          method: "POST",
          body: JSON.stringify(
            billPayload({ confirmAdditionalCostsOmitted: true }),
          ),
        },
      );
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.error).toBe("Xero bill sync is already running.");
    });
  });

  test("allows stale pending bill sync rows to recover", async ({ db }) => {
    await withNoAccountingConnection(db, async () => {
      const ts = Date.now();
      const orderId = await createReceivedPurchaseOrder(ts);
      await receiveOrderLine(db, orderId);

      await db.insert(accountingDocumentSyncs).values({
        organizationId: getOrgId(),
        provider: ACCOUNTING_PROVIDER_XERO,
        documentType: ACCOUNTING_DOCUMENT_PURCHASE_BILL,
        documentId: orderId,
        pushStatus: "pending",
        lastPushAttemptAt: new Date(Date.now() - 11 * 60 * 1000),
      });

      const response = await testFetch(
        `/api/purchase-orders/${orderId}/accounting-bill`,
        { method: "POST", body: JSON.stringify(billPayload()) },
      );
      const body = await response.json();

      expectBillAttemptReachedXeroBoundary(response.status, body);
    });
  });

  test("requires purchasing write access", async () => {
    const cookie = await createPurchasingReadOnlyCookie();

    const response = await testFetchWithCookie(
      cookie,
      "/api/purchase-orders/not-a-real-id/accounting-bill",
      { method: "POST", body: JSON.stringify(billPayload()) },
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("You do not have permission to update purchasing.");
  });

  test("QuickBooks bill sync rejects taxable purchase orders before external API", async ({
    db,
  }) => {
    await withOnlyQuickBooksConnection(db, async () => {
      const ts = Date.now();
      const orderId = await createReceivedPurchaseOrder(ts);
      await receiveOrderLine(db, orderId);
      await db
        .update(purchaseOrderLines)
        .set({ taxRatePercent: "5" })
        .where(eq(purchaseOrderLines.purchaseOrderId, orderId));

      const response = await testFetch(
        `/api/purchase-orders/${orderId}/accounting-bill`,
        {
          method: "POST",
          body: JSON.stringify({
            ...billPayload({ confirmAdditionalCostsOmitted: true }),
            accountingPurchaseAccountCode: "QB-EXPENSE",
          }),
        },
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(body.error).toBe(
        "QuickBooks tax mapping is not available yet. Remove tax from this purchase order before creating a QuickBooks bill.",
      );

      const rows = await db
        .select()
        .from(accountingDocumentSyncs)
        .where(
          and(
            eq(accountingDocumentSyncs.provider, ACCOUNTING_PROVIDER_QUICKBOOKS),
            eq(
              accountingDocumentSyncs.documentType,
              ACCOUNTING_DOCUMENT_PURCHASE_BILL,
            ),
            eq(accountingDocumentSyncs.documentId, orderId),
          ),
        );
      expect(rows).toHaveLength(0);
    });
  });
});
