import { expect, test } from "../fixtures";
import {
  accountingDocumentSyncs,
  customers,
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
});

test("xero settings show automation toggles, draft defaults, and export history", async ({
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

  await page.goto("/settings");

  await expect(
    page.getByRole("heading", { name: "Export to Xero" })
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Auto-export sales invoices" })
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Auto-export purchase orders" })
  ).toBeChecked();
  await expect(page.getByText("Draft")).toHaveCount(2);

  await page.getByRole("button", { name: "Edit defaults" }).click();
  await expect(
    page.getByRole("heading", { name: "Posting defaults" })
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Tax treatment" })
  ).toContainText("Output tax");
  await expect(page.getByText("Standard tax treatment for sales invoices.")).toBeVisible();
  await page.getByRole("button", { name: "Purchase orders" }).click();
  await expect(
    page.getByRole("combobox", { name: "Tax treatment" })
  ).toContainText("No tax");
  await expect(page.getByText("Use when this Xero organisation should not apply tax.")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page
    .getByRole("checkbox", { name: "Auto-export sales invoices" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Turn off auto-export?" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Turn off" }).click();
  await expect(
    page.getByRole("checkbox", { name: "Auto-export sales invoices" })
  ).not.toBeChecked();

  await page.getByRole("button", { name: "Export history" }).first().click();
  await expect(page.getByRole("heading", { name: "Export history" })).toBeVisible();
  await expect(page.getByText(orderNumber)).toBeVisible();
  await expect(page.getByText(customerName)).toBeVisible();
});
