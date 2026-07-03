import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
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
  testFetch,
} from "../../helpers/api";
import { withAccountingConnectionFixtureLock } from "../../helpers/accounting-connection-fixture-lock";
import {
  accountingDocumentSyncs,
  integrationConnections,
  member,
  purchaseOrderAdditionalCosts,
  purchaseOrderLines,
  purchaseOrders,
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

  return { cookie: cookie!, userId: createdUser.id };
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
  if (
    status === 500 &&
    (body.error === "Xero token encryption key 'test-key' is not configured." ||
      body.error === "XERO_CLIENT_ID is not configured.")
  ) {
    return;
  }

  expect(status, JSON.stringify(body)).toBe(409);
  expect(body.error).toBe(
    "Connect an accounting provider before creating supplier bills.",
  );
}

function editableGrid(page: Page, index = 0) {
  return page.locator('[data-slot="editable-line-data-grid"]').nth(index);
}

async function editGridCell(
  page: Page,
  colId: string,
  value: string,
  rowIndex = 0,
  gridIndex = 0,
) {
  const cell = editableGrid(page, gridIndex)
    .locator(`.ag-row[row-index="${rowIndex}"] .ag-cell[col-id="${colId}"]`)
    .first();
  await expect(cell).toBeVisible();
  await cell.click();
  const input = page.locator(".ag-cell-inline-editing input").first();
  await expect(input).toBeVisible();
  await input.fill(value);
  await input.press("Enter");
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

  return order.body.id as string;
}

async function withNoAccountingConnection<T>(db: TestDb, fn: () => Promise<T>) {
  return withAccountingConnectionFixtureLock(() =>
    withNoAccountingConnectionUnlocked(db, fn),
  );
}

async function withNoAccountingConnectionUnlocked<T>(
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
  return withAccountingConnectionFixtureLock(() =>
    withOnlyQuickBooksConnectionUnlocked(db, fn),
  );
}

async function withOnlyQuickBooksConnectionUnlocked<T>(
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
  return withAccountingConnectionFixtureLock(() =>
    withOnlyXeroConnectionUnlocked(db, fn),
  );
}

async function withOnlyXeroConnectionUnlocked<T>(
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
  test("keeps bill management reachable on a dirty persisted purchase order", async ({
    page,
  }) => {
    const ts = Date.now();
    const { materialId, supplierId } = await createMaterialAndSupplier(ts);
    const order = await createPurchaseOrder({
      supplierId,
      expectedDate: "2026-05-27",
      lines: [{ itemId: materialId, quantityOrdered: "5", unitCost: "4.00" }],
    });
    expect(order.status).toBe(201);

    await page.goto(`/purchasing/orders/${order.body.id}`);
    await page
      .getByRole("textbox", { name: "Additional info" })
      .fill(`Dirty bill gate ${ts}`);
    await page.keyboard.press("Tab");

    await page.getByLabel("Bill actions").click();
    await expect(
      page.getByRole("menuitem", { name: "Manage bills..." }),
    ).toBeEnabled();
  });

  test("keeps manual billed status reachable on a dirty persisted purchase order", async ({
    db,
    page,
  }) => {
    const ts = Date.now();
    const { materialId, supplierId } = await createMaterialAndSupplier(ts);
    const order = await createPurchaseOrder({
      supplierId,
      expectedDate: "2026-05-27",
      lines: [{ itemId: materialId, quantityOrdered: "5", unitCost: "4.00" }],
    });
    expect(order.status).toBe(201);
    const orderId = order.body.id as string;

    await page.goto(`/purchasing/orders/${orderId}`);
    await page
      .getByRole("textbox", { name: "Additional info" })
      .fill(`Dirty manual bill status ${ts}`);
    await page.keyboard.press("Tab");

    await page.getByLabel("Bill actions").click();
    await page.getByRole("menuitem", { name: "Billed", exact: true }).click();
    await expect(page.getByLabel("Bill actions")).toContainText("Billed", {
      timeout: 15_000,
    });

    const [saved] = await db
      .select({ purchaseBillManualStatus: purchaseOrders.purchaseBillManualStatus })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, orderId));
    expect(saved.purchaseBillManualStatus).toBe("billed");
  });

  test("keeps bill management reachable when manual billed status masks a pending sync row", async ({
    db,
    page,
  }) => {
    const ts = Date.now();
    const orderId = await createReceivedPurchaseOrder(ts);

    await db.insert(accountingDocumentSyncs).values({
      organizationId: getOrgId(),
      provider: ACCOUNTING_PROVIDER_XERO,
      documentType: ACCOUNTING_DOCUMENT_PURCHASE_BILL,
      documentId: orderId,
      pushStatus: "pending",
      lastPushAttemptAt: new Date(),
    });

    const manualStatusResponse = await testFetch(
      `/api/purchase-orders/${orderId}/bill-status`,
      {
        method: "PATCH",
        body: JSON.stringify({ status: "billed" }),
      },
    );
    expect(manualStatusResponse.status).toBe(200);

    await page.goto(`/purchasing/orders/${orderId}`);
    await expect(page.getByLabel("Bill actions")).toContainText("Billed");

    await page.getByLabel("Bill actions").click();
    await expect(
      page.getByRole("menuitem", { name: "Manage bills..." }),
    ).toBeEnabled();
  });

  test("bill management flushes new additional costs before building the bill payload", async ({
    db,
    page,
  }) => {
    await withOnlyXeroConnection(db, async () => {
      const ts = Date.now();
      const { materialId, supplierId } = await createMaterialAndSupplier(ts);
      const order = await createPurchaseOrder({
        supplierId,
        expectedDate: "2026-05-27",
        lines: [{ itemId: materialId, quantityOrdered: "5", unitCost: "4.00" }],
      });
      expect(order.status).toBe(201);

      await page.route("**/api/accounting/connections/xero/accounts", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ accounts: [{ code: "500", name: "COGS" }] }),
        }),
      );

      type BillPayloadBody = {
        groups?: Array<{ additionalCostIds?: string[]; amount?: string }>;
      };
      const billPayload: { body: BillPayloadBody | null } = { body: null };
      let releaseSave!: () => void;
      const saveCanFinish = new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
      let saveCalls = 0;
      await page.route(`**/api/purchase-orders/${order.body.id}`, async (route) => {
        if (
          route.request().method() === "PUT" ||
          route.request().method() === "PATCH"
        ) {
          saveCalls += 1;
          await saveCanFinish;
        }
        await route.continue();
      });
      await page.route(
        `**/api/purchase-orders/${order.body.id}/accounting-bill`,
        async (route) => {
          billPayload.body = route.request().postDataJSON();
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              status: "pushed",
              created: true,
              adopted: false,
              xeroBillId: "test-bill-id",
              xeroBillNumber: "BILL-UI-FLUSH",
            }),
          });
        },
      );

      await page.goto(`/purchasing/orders/${order.body.id}`);
      await expect(
        editableGrid(page).locator(".ag-center-cols-container .ag-row"),
      ).toHaveCount(1, { timeout: 15_000 });
      await page.getByRole("button", { name: "Additional costs" }).click();
      await editGridCell(page, "amount", "12.00", 0, 1);
      await expect.poll(() => saveCalls, { timeout: 15_000 }).toBeGreaterThan(0);

      await page.getByLabel("Bill actions").click();
      await page.getByRole("menuitem", { name: "Manage bills..." }).click();

      const sheet = page.getByRole("dialog", { name: "Create Xero bills" });
      await expect(sheet).toBeHidden();
      releaseSave();
      await expect(sheet).toBeVisible();
      await expect(sheet.getByText("$32.00")).toBeVisible();
      await sheet.getByRole("button", { name: /Bill Gate Supplier/ }).click();
      await sheet
        .getByLabel("Supplier invoice number")
        .fill(`BILL-UI-FLUSH-${ts}`);
      await sheet.getByRole("button", { name: "Push 1 to Xero" }).click();
      await expect.poll(() => billPayload.body, { timeout: 20_000 }).not.toBeNull();

      const [cost] = await db
        .select({ id: purchaseOrderAdditionalCosts.id })
        .from(purchaseOrderAdditionalCosts)
        .where(eq(purchaseOrderAdditionalCosts.purchaseOrderId, order.body.id));
      expect(cost?.id).toBeTruthy();
      expect(billPayload.body?.groups?.[0]?.additionalCostIds).toEqual([cost.id]);
    });
  });

  test("does not block ordered POs before receipt", async ({ db }) => {
    await withNoAccountingConnection(db, async () => {
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

  test("does not block bill creation for newly created purchase orders", async ({ db }) => {
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

      expectBillAttemptReachedXeroBoundary(response.status, body);
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

  test("grouped bill payloads ignore invoice fields on unchecked groups", async ({ db }) => {
    await withOnlyXeroConnection(db, async () => {
      const ts = Date.now();
      const { materialId, supplierId } = await createMaterialAndSupplier(ts);
      const carrier = await createSupplier({ name: `Fast Bill Carrier ${ts}` });
      expect(carrier.status).toBe(201);
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
              supplierId: carrier.body.id,
              distributionMethod: "not_distributed",
              accountingPurchaseAccountCode: "500",
              amount: "12.00",
            },
          ],
        }),
      });
      const order = await orderResponse.json();
      expect(orderResponse.status).toBe(201);

      const response = await testFetch(
        `/api/purchase-orders/${order.id}/accounting-bill`,
        {
          method: "POST",
          body: JSON.stringify({
            ...billPayload({ confirmAdditionalCostsOmitted: true }),
            groups: [
              {
                groupKey: `supplier:${supplierId}`,
                include: true,
                invoiceNumber: `BILL-SUP-${ts}`,
                accountingPurchaseAccountCode: "500",
              },
              {
                groupKey: `additional-cost:${carrier.body.id}`,
                include: false,
                invoiceNumber: "",
                accountingPurchaseAccountCode: "",
              },
            ],
          }),
        },
      );
      const body = await response.json();

      expectBillAttemptReachedXeroBoundary(response.status, body);
    });
  });

  test("grouped bill payloads require unique invoice numbers", async ({ db }) => {
    await withOnlyXeroConnection(db, async () => {
      const ts = Date.now();
      const { materialId, supplierId } = await createMaterialAndSupplier(ts);
      const carrier = await createSupplier({
        name: `Fast Duplicate Bill Carrier ${ts}`,
      });
      expect(carrier.status).toBe(201);
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
              supplierId: carrier.body.id,
              distributionMethod: "not_distributed",
              accountingPurchaseAccountCode: "500",
              amount: "12.00",
            },
          ],
        }),
      });
      const order = await orderResponse.json();
      expect(orderResponse.status).toBe(201);

      const response = await testFetch(
        `/api/purchase-orders/${order.id}/accounting-bill`,
        {
          method: "POST",
          body: JSON.stringify({
            ...billPayload({ confirmAdditionalCostsOmitted: true }),
            groups: [
              {
                groupKey: `supplier:${supplierId}`,
                include: true,
                invoiceNumber: `BILL-DUP-${ts}`,
                accountingPurchaseAccountCode: "500",
              },
              {
                groupKey: `additional-cost:${carrier.body.id}`,
                include: true,
                invoiceNumber: `BILL-DUP-${ts}`,
                accountingPurchaseAccountCode: "500",
              },
            ],
          }),
        },
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(JSON.stringify(body)).toContain(
        "Invoice numbers must be unique per bill group",
      );
    });
  });

  test("QuickBooks rejects grouped bill payloads instead of merging suppliers", async ({
    db,
  }) => {
    await withOnlyQuickBooksConnection(db, async () => {
      const ts = Date.now();
      const { materialId, supplierId } = await createMaterialAndSupplier(ts);
      const carrier = await createSupplier({
        name: `Fast QB Grouped Bill Carrier ${ts}`,
      });
      expect(carrier.status).toBe(201);
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
              supplierId: carrier.body.id,
              distributionMethod: "not_distributed",
              accountingPurchaseAccountCode: "500",
              amount: "12.00",
            },
          ],
        }),
      });
      const order = await orderResponse.json();
      expect(orderResponse.status).toBe(201);

      const response = await testFetch(
        `/api/purchase-orders/${order.id}/accounting-bill`,
        {
          method: "POST",
          body: JSON.stringify({
            ...billPayload({ confirmAdditionalCostsOmitted: true }),
            groups: [
              {
                groupKey: `supplier:${supplierId}`,
                include: true,
                invoiceNumber: `QB-SUP-${ts}`,
                accountingPurchaseAccountCode: "500",
              },
              {
                groupKey: `additional-cost:${carrier.body.id}`,
                include: true,
                invoiceNumber: `QB-CAR-${ts}`,
                accountingPurchaseAccountCode: "500",
              },
            ],
          }),
        },
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe(
        "Grouped supplier bills are only supported for Xero right now.",
      );
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
    const limitedUser = await createPurchasingReadOnlyCookie();

    try {
      const response = await testFetchWithCookie(
        limitedUser.cookie,
        "/api/purchase-orders/not-a-real-id/accounting-bill",
        { method: "POST", body: JSON.stringify(billPayload()) },
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toBe("You do not have permission to update purchasing.");
    } finally {
      await authDb.delete(user).where(eq(user.id, limitedUser.userId));
    }
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
