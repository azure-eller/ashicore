import dotenv from "dotenv";
import { Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { Pool as PgPool } from "pg";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  createItem,
  createPurchaseOrder,
  createSupplier,
  getOrgId,
  getUnitId,
  receivePurchaseOrder,
  submitPurchaseOrder,
  testFetch,
} from "../../helpers/api";
import { TEST_ACCOUNT_EMAIL } from "../../helpers/test-account";
import {
  accountingDocumentSyncs,
  member,
  purchaseOrderLines,
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
const ACCOUNTING_DOCUMENT_PURCHASE_BILL = "purchase_bill";
const ACCOUNTING_PROVIDER_XERO = "xero";

function billPayload() {
  return {
    invoiceNumber: `BILL-GATE-${Date.now()}`,
    billDate: "2026-05-27",
    dueDate: "2026-05-27",
    reference: null,
  };
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

async function receiveOrderLine(db: ReturnType<typeof createAuthDb>, orderId: string) {
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

test.describe("Xero purchase bill gates", () => {
  test("blocks bill creation before the PO is fully received", async () => {
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
    expect(body.error).toBe("V1 supports Xero bills after full receipt.");
  });

  test("requires confirmation when additional costs will be omitted", async ({ db }) => {
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

    expect(response.status).toBe(400);
    expect(body.error).toBe(
      "Confirm that additional costs will be added manually in Xero.",
    );
  });

  test("blocks retry while a bill sync is recently pending", async ({ db }) => {
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
      { method: "POST", body: JSON.stringify(billPayload()) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("Xero bill sync is already running.");
  });

  test("allows stale pending bill sync rows to recover", async ({ db }) => {
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

    expect(response.status).toBe(409);
    expect(body.error).toBe("Xero is not connected for this organization.");
  });

  test("requires purchasing write access", async () => {
    const [testUser] = await authDb
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, TEST_ACCOUNT_EMAIL))
      .limit(1);
    expect(testUser).toBeTruthy();

    const [membership] = await authDb
      .select({ id: member.id, role: member.role })
      .from(member)
      .where(
        and(eq(member.userId, testUser.id), eq(member.organizationId, getOrgId())),
      )
      .limit(1);
    expect(membership).toBeTruthy();

    try {
      await authDb
        .update(member)
        .set({ role: "access:matrix,member,purchasing:read" })
        .where(eq(member.id, membership.id));

      const response = await testFetch(
        "/api/purchase-orders/not-a-real-id/accounting-bill",
        { method: "POST", body: JSON.stringify(billPayload()) },
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toBe("You do not have permission to update purchasing.");
    } finally {
      await authDb
        .update(member)
        .set({ role: membership.role })
        .where(eq(member.id, membership.id));
    }
  });
});
