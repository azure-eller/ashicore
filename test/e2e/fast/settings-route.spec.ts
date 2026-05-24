import { expect, test } from "../fixtures";
import {
  accountingDocumentSyncs,
  customers,
  integrationAuditEvents,
  integrationConnections,
  salesOrders,
} from "@/lib/db/schema";
import { readTestEnv } from "../../helpers/test-env";

const { TEST_ORG_ID } = readTestEnv();

test("settings renders in the default fast smoke lane", async ({ page }) => {
  await page.goto("/settings");

  await expect(
    page.getByRole("heading", { name: "Account", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Enable daily manufacturing report" })
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Enable demand queue allocation mode" })
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Configure daily manufacturing report" }).click();
  await expect(
    page.getByRole("heading", { name: "Daily Manufacturing Report" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send report" })
  ).toBeVisible();

  const firstRecipient = page.getByRole("dialog").getByRole("checkbox").first();
  if (!(await firstRecipient.isChecked())) {
    await firstRecipient.click();
  }

  const graphLabel = `Fast report graph ${Date.now().toString(36)}`;
  await page.getByRole("button", { name: "Add graph" }).click();
  await page.getByLabel("Label").last().fill(graphLabel);
  await page.getByLabel("Unit").last().fill("Tote");
  await page.getByLabel("Product/SKU contains").last().fill("Nutrient");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(
    page.getByRole("heading", { name: "Daily Manufacturing Report" })
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Configure daily manufacturing report" }).click();
  await expect(page.getByLabel("Label").last()).toHaveValue(graphLabel);

  const manualSendRequest = page.waitForRequest((request) =>
    request.url().endsWith("/api/reports/daily-manufacturing/manual-send")
  );
  await page.route("**/api/reports/daily-manufacturing/manual-send", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        runId: "test-run",
        reportDate: "2026-05-15",
        recipientCount: 1,
        source: "generated",
      }),
    });
  });
  await page.getByRole("button", { name: "Send report" }).click();
  const request = await manualSendRequest;
  const body = request.postDataJSON() as { recipientUserIds?: string[] };
  expect(body.recipientUserIds?.length).toBeGreaterThan(0);
});

test("xero settings show invoice automation, PO import, and sync history", async ({
  db,
  page,
}) => {
  const run = Date.now().toString(36);
  const customerName = `Settings Xero Customer ${run}`;
  const orderNumber = `SO-XERO-${run}`;

  await db
    .insert(integrationConnections)
    .values({
      organizationId: TEST_ORG_ID,
      provider: "xero",
      tenantId: `tenant-${run}`,
      tenantName: "Paonia Soil Co.",
      authorizedTenants: [{ tenantId: `tenant-${run}`, tenantName: "Paonia Soil Co." }],
      accessTokenCiphertext: `test-access-token-ciphertext-${run}`,
      refreshTokenCiphertext: `test-refresh-token-ciphertext-${run}`,
      tokenEncryptionKeyId: "test",
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      defaultAccountCode: "400",
      defaultTaxType: "OUTPUT",
      invoiceStatusPreference: "DRAFT",
      autoPushSalesInvoices: true,
      autoPushPurchaseOrders: true,
      autoEmailSalesInvoices: false,
      autoEmailPurchaseOrders: false,
      purchaseOrderDefaultAccountCode: "500",
      purchaseOrderDefaultTaxType: "NONE",
      purchaseOrderStatusPreference: "DRAFT",
    })
    .onConflictDoUpdate({
      target: [
        integrationConnections.organizationId,
        integrationConnections.provider,
      ],
      set: {
        tenantId: `tenant-${run}`,
        tenantName: "Paonia Soil Co.",
        authorizedTenants: [{ tenantId: `tenant-${run}`, tenantName: "Paonia Soil Co." }],
        accessTokenCiphertext: `test-access-token-ciphertext-${run}`,
        refreshTokenCiphertext: `test-refresh-token-ciphertext-${run}`,
        tokenEncryptionKeyId: "test",
        tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        defaultAccountCode: "400",
        defaultTaxType: "OUTPUT",
        invoiceStatusPreference: "DRAFT",
        autoPushSalesInvoices: true,
        autoPushPurchaseOrders: true,
        autoEmailSalesInvoices: false,
        autoEmailPurchaseOrders: false,
        purchaseOrderDefaultAccountCode: "500",
        purchaseOrderDefaultTaxType: "NONE",
        purchaseOrderStatusPreference: "DRAFT",
        updatedAt: new Date(),
      },
    });

  const [customer] = await db
    .insert(customers)
    .values({
      organizationId: TEST_ORG_ID,
      name: customerName,
      email: `xero-settings-${run}@example.com`,
    })
    .returning({ id: customers.id });

  const [order] = await db.insert(salesOrders).values({
    organizationId: TEST_ORG_ID,
    orderNumber,
    customerId: customer.id,
    customerName,
    status: "shipped",
    orderDate: "2026-05-11",
    totalAmount: "42",
  }).returning({ id: salesOrders.id });

  await db.insert(accountingDocumentSyncs).values({
    organizationId: TEST_ORG_ID,
    provider: "xero",
    documentType: "sales_order",
    documentId: order.id,
    externalDocumentId: `xero-invoice-${run}`,
    externalDocumentNumber: `INV-${run}`,
    pushStatus: "pushed",
    pushedAt: new Date(),
  });

  await db.insert(integrationAuditEvents).values({
    organizationId: TEST_ORG_ID,
    actorType: "process",
    processName: "accounting_purchase_order_sync",
    eventType: "accounting_auto_sync",
    outcome: "failure",
    source: "GET /api/internal/accounting-purchase-order-sync",
    provider: "xero",
    tenantName: "Paonia Soil Co.",
    localEntityType: "purchase_orders",
    metadata: {
      message: "Missing scope: accounting.transactions",
    },
  });
  await db.insert(integrationAuditEvents).values({
    organizationId: TEST_ORG_ID,
    actorType: "process",
    processName: "accounting_purchase_order_sync",
    eventType: "accounting_auto_sync",
    outcome: "success",
    source: "GET /api/internal/accounting-purchase-order-sync",
    provider: "xero",
    tenantName: "Paonia Soil Co.",
    localEntityType: "purchase_orders",
    metadata: {
      fetched: 1,
      created: 0,
      updated: 0,
      skipped: 0,
      errorCount: 0,
      autoSkippedCount: 1,
      autoSkipped: [
        {
          externalPurchaseOrderId: `xero-po-review-${run}`,
          externalPurchaseOrderNumber: `PO-REVIEW-${run}`,
          reason: "One or more lines would create a new material.",
        },
      ],
    },
  });

  await page.goto("/settings");

  await expect(
    page.getByRole("heading", { name: "Automation" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Imports", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Auto-export sales invoices" })
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Auto-sync purchase orders from Xero" })
  ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Auto-export purchase orders" })
  ).toHaveCount(0);
  await expect(page.getByText("Draft")).toHaveCount(1);

  await expect(page.getByText("400")).toBeVisible();
  await expect(page.getByText("Output tax")).toBeVisible();
  await expect(page.getByText("500")).toHaveCount(0);
  await expect(page.getByText("No tax")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Defaults" })).toBeVisible();

  await page.getByRole("button", { name: "View Xero sync history" }).click();
  await expect(
    page.getByRole("heading", { name: "Sync history" })
  ).toBeVisible();
  await expect(page.getByText("Purchase order auto-sync").first()).toBeVisible();
  await expect(
    page.getByText("Missing scope: accounting.transactions").first()
  ).toBeVisible();
  await expect(page.getByText(`PO-REVIEW-${run}`, { exact: false })).toBeVisible();
  await expect(page.getByText(orderNumber)).toBeVisible();
});
