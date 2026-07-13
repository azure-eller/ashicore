import http from "node:http";
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { and, asc, eq, inArray } from "drizzle-orm";
import { test, expect } from "../fixtures";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import {
  integrationConnections,
  integrationExternalRecords,
  inventoryDemandSummary,
  inventoryEvents,
  inventoryItemBalances,
  accountingDocumentSyncs,
  customers,
  customerContacts,
  billingUsageEvents,
  manufacturingOrders,
  salesOrderLines,
  salesOrders,
} from "../../../lib/db/schema";
import {
  addCustomerContact,
  createCustomer,
  createItem,
  createManufacturingOrder,
  createSalesOrder,
  fulfillSalesOrder,
  getBaseUrl,
  getOrgId,
  getSessionCookie,
  getUnitId,
  testFetch,
} from "../../helpers/api";
import { buildStorageState } from "../../helpers/test-env";
import { withAccountingConnectionFixtureLock } from "../../helpers/accounting-connection-fixture-lock";

const ACCOUNTING_PROVIDER_XERO = "xero";
const ACCOUNTING_PROVIDER_QUICKBOOKS = "quickbooks";
const ACCOUNTING_DOCUMENT_SALES_ORDER = "sales_order";

function editableGrid(page: Page, index = 0) {
  return page.locator('[data-slot="editable-line-data-grid"]').nth(index);
}

async function expectRows(page: Page, count: number, gridIndex = 0) {
  await expect(
    editableGrid(page, gridIndex).locator(".ag-center-cols-container .ag-row"),
  ).toHaveCount(count, { timeout: 15_000 });
}

async function editGridCell(
  page: Page,
  colId: string,
  value: string,
  rowIndex = 0,
) {
  const cell = editableGrid(page)
    .locator(`.ag-row[row-index="${rowIndex}"] .ag-cell[col-id="${colId}"]`)
    .first();
  await expect(cell).toBeVisible();
  await cell.click();
  const input = page.locator(".ag-cell-inline-editing input").first();
  await expect(input).toBeVisible();
  await input.fill(value);
  await input.press("Enter");
}

async function selectInventoryGridItem(
  page: Page,
  rowIndex: number,
  itemName: string,
) {
  const cell = editableGrid(page)
    .locator(`.ag-row[row-index="${rowIndex}"] .ag-cell[col-id="itemId"]`)
    .first();
  await expect(cell).toBeVisible();
  await cell.click();
  const input = page.getByPlaceholder("Search items...");
  await expect(input).toBeVisible();
  await input.fill(itemName);
  await page
    .locator('[data-slot="combobox-item"]')
    .filter({ hasText: itemName })
    .first()
    .click();
}

function isoDaysFromNow(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function withOnlyQuickBooksConnection<T>(
  db: Parameters<Parameters<typeof test>[2]>[0]["db"],
  fn: () => Promise<T>,
) {
  return withAccountingConnectionFixtureLock(() =>
    withOnlyQuickBooksConnectionUnlocked(db, fn),
  );
}

async function withOnlyQuickBooksConnectionUnlocked<T>(
  db: Parameters<Parameters<typeof test>[2]>[0]["db"],
  fn: () => Promise<T>,
) {
  const existing = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organizationId, (await import("../../helpers/api")).getOrgId()),
        inArray(integrationConnections.provider, [
          ACCOUNTING_PROVIDER_XERO,
          ACCOUNTING_PROVIDER_QUICKBOOKS,
        ]),
      ),
    );

  const { getOrgId } = await import("../../helpers/api");
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

function startShopifyServer(payload: unknown) {
  const server = http.createServer((req, res) => {
    expect(req.headers["x-shopify-access-token"]).toBe("shopify-fast-token");
    expect(req.url).toContain("/admin/api/2025-10/orders.json");
    expect(req.url).toContain("financial_status=paid");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(payload));
  });

  return new Promise<{ baseUrl: string; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Shopify test server did not bind to a port.");
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

test.describe("sales demand and shipping heartbeat", () => {
  const ts = Date.now();
  const unitId = getUnitId();

  test("new sales order waits for a customer before first autosave", async ({
    db,
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const orderNumber = `SO-DEFER-${unique}`;
    const customer = await createCustomer({
      name: `Fast Deferred SO Customer ${unique}`,
    });
    expect(customer.status).toBe(201);

    await page.goto("/sales/order");
    await expect(page.getByText("New sales order")).toBeVisible();
    // The save pill states the blocker, before and after dirty edits.
    await expect(page.getByText("Customer is required").first()).toBeVisible();
    await page.getByLabel("Sales order").fill(orderNumber);
    await page.waitForTimeout(1_000);
    await expect(page.getByText("Customer is required").first()).toBeVisible();

    let rows = await db
      .select({ id: salesOrders.id })
      .from(salesOrders)
      .where(eq(salesOrders.orderNumber, orderNumber));
    expect(rows).toHaveLength(0);

    await page.getByPlaceholder("Search customers…").fill(customer.body.name);
    await page
      .locator('[data-slot="combobox-item"]')
      .filter({ hasText: customer.body.name })
      .first()
      .click();
    await page.waitForURL(/\/sales\/order\/[0-9a-f-]+$/);

    rows = await db
      .select({
        id: salesOrders.id,
        customerId: salesOrders.customerId,
        orderNumber: salesOrders.orderNumber,
      })
      .from(salesOrders)
      .where(eq(salesOrders.orderNumber, orderNumber));
    expect(rows).toEqual([
      {
        id: page.url().split("/").pop(),
        customerId: customer.body.id,
        orderNumber,
      },
    ]);
  });

  async function createStockedProduct(label: string, stock: string) {
    const component = await createItem({
      itemType: "material",
      name: `Fast Sales ${label} Component ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-SALES-${label}-COMP-${ts}`,
      category: `Fast Sales ${ts}`,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "100",
      safetyStock: "0",
      bom: [],
    });
    expect(component.status, JSON.stringify(component.body)).toBe(201);

    const product = await createItem({
      itemType: "product",
      name: `Fast Sales ${label} Product ${ts}`,
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-SALES-${label}-${ts}`,
      category: `Fast Sales ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "12.00",
      stock,
      safetyStock: "0",
      bom: [{ componentId: component.body.id, quantity: "1" }],
    });
    expect(product.status, JSON.stringify(product.body)).toBe(201);

    return product.body.id as string;
  }

  test("sales order creates demand without consuming physical stock", async ({
    db,
  }) => {
    const productId = await createStockedProduct("Demand", "10");

    const customer = await createCustomer({ name: `Fast Sales Customer ${ts}` });
    expect(customer.status).toBe(201);

    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-01",
      shipDate: "2026-05-02",
      lines: [{ itemId: productId, quantity: "6", unitPrice: "12.00" }],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);

    const [line] = await db
      .select({ id: salesOrderLines.id, quantity: salesOrderLines.quantity })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id));
    expect(line.quantity).toBe("6.0000");

    const [demand] = await db
      .select({ quantity: inventoryDemandSummary.quantity })
      .from(inventoryDemandSummary)
      .where(
        and(
          eq(inventoryDemandSummary.itemId, productId),
          eq(inventoryDemandSummary.referenceType, "sales_order_line"),
          eq(inventoryDemandSummary.referenceId, line.id)
        )
      );
    expect(demand.quantity).toBe("6.0000");

    const [balance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        demandQty: inventoryItemBalances.demandQty,
        availableToPromise: inventoryItemBalances.availableToPromise,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, productId));
    expect(balance).toMatchObject({
      onHandQty: "10.0000",
      demandQty: "6.0000",
      availableToPromise: "4.0000",
    });
  });

  test("sales order reads use one default invoice sync row", async ({ db }) => {
    const productId = await createStockedProduct("DefaultInvoiceSync", "10");
    const customer = await createCustomer({
      name: `Fast Default Invoice Sync Customer ${ts}`,
    });
    expect(customer.status).toBe(201);

    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-01",
      shipDate: "2026-05-02",
      lines: [{ itemId: productId, quantity: "2", unitPrice: "12.00" }],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);

    await db.insert(accountingDocumentSyncs).values([
      {
        organizationId: getOrgId(),
        provider: ACCOUNTING_PROVIDER_XERO,
        documentType: ACCOUNTING_DOCUMENT_SALES_ORDER,
        documentId: order.body.id,
        externalDocumentId: `xero-invoice-default-${ts}`,
        externalDocumentNumber: `INV-DEFAULT-${ts}`,
        pushStatus: "pushed",
        pushedAt: new Date(),
      },
      {
        organizationId: getOrgId(),
        provider: ACCOUNTING_PROVIDER_XERO,
        documentType: ACCOUNTING_DOCUMENT_SALES_ORDER,
        documentId: order.body.id,
        groupKey: `bol:${ts}`,
        externalDocumentId: `xero-invoice-bol-${ts}`,
        externalDocumentNumber: `INV-BOL-${ts}`,
        pushStatus: "pushed",
        pushedAt: new Date(),
      },
    ]);

    const salesOrdersResponse = await testFetch("/api/sales-orders");
    expect(salesOrdersResponse.status).toBe(200);
    const salesOrderRows = (await salesOrdersResponse.json()) as Array<{
      id: string;
      xeroInvoiceNumber: string | null;
    }>;
    const matchingRows = salesOrderRows
      .filter((row) => row.id === order.body.id)
      .map((row) => ({
        id: row.id,
        xeroInvoiceNumber: row.xeroInvoiceNumber,
      }));
    expect(matchingRows).toEqual([
      {
        id: order.body.id,
        xeroInvoiceNumber: `INV-DEFAULT-${ts}`,
      },
    ]);

    const detailResponse = await testFetch(`/api/sales-orders/${order.body.id}`);
    expect(detailResponse.status).toBe(200);
    const detail = (await detailResponse.json()) as {
      id: string;
      xeroInvoiceNumber: string | null;
    };
    expect(detail).toMatchObject({
      id: order.body.id,
      xeroInvoiceNumber: `INV-DEFAULT-${ts}`,
    });
  });

  test("sales order inline patches bump the card document version", async ({
    db,
  }) => {
    const productId = await createStockedProduct("PatchVersion", "10");
    const customer = await createCustomer({
      name: `Fast Patch Version Customer ${ts}`,
    });
    expect(customer.status).toBe(201);

    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-01",
      lines: [{ itemId: productId, quantity: "2", unitPrice: "12.00" }],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);

    const [created] = await db
      .select({ version: salesOrders.version })
      .from(salesOrders)
      .where(eq(salesOrders.id, order.body.id));
    expect(created.version).toBe(1);

    const headerPatch = await testFetch(`/api/sales-orders/${order.body.id}`, {
      method: "PATCH",
      body: JSON.stringify({ notes: "inline header edit" }),
    });
    expect(headerPatch.status, await headerPatch.text()).toBe(200);
    const headerBody = await headerPatch.json();
    expect(headerBody.version).toBe(2);

    const [line] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id));
    const linePatch = await testFetch(
      `/api/sales-orders/${order.body.id}/lines/${line.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ quantity: "3" }),
      },
    );
    expect(linePatch.status, await linePatch.text()).toBe(200);
    const lineBody = await linePatch.json();
    expect(lineBody.version).toBe(3);

    const [updated] = await db
      .select({ version: salesOrders.version })
      .from(salesOrders)
      .where(eq(salesOrders.id, order.body.id));
    expect(updated.version).toBe(3);
  });

  test("sales order stale save returns the shared conflict envelope with the fresh order", async ({
    db,
  }) => {
    const productId = await createStockedProduct("ConflictEnvelope", "10");
    const customer = await createCustomer({
      name: `Fast Conflict Envelope Customer ${ts}`,
    });
    expect(customer.status).toBe(201);

    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-01",
      lines: [{ itemId: productId, quantity: "2", unitPrice: "12.00" }],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const orderDetailResponse = await testFetch(`/api/sales-orders/${order.body.id}`);
    expect(orderDetailResponse.status).toBe(200);
    const orderDetail = await orderDetailResponse.json();

    const basePayload = {
      orderNumber: orderDetail.orderNumber,
      customerId: customer.body.id,
      customerProjectId: null,
      status: "open",
      orderDate: "2026-05-01",
      shipDate: null,
      requestedDate: null,
      notes: null,
      shipLine1: null,
      shipLine2: null,
      shipCity: null,
      shipRegion: null,
      shipPostcode: null,
      shipCountry: null,
      billingLine1: null,
      billingLine2: null,
      billingCity: null,
      billingRegion: null,
      billingPostcode: null,
      billingCountry: null,
      shippingFeeDescription: null,
      shippingFeeAmount: "0",
      shippingFeeTaxAmount: "0",
      expectedVersion: orderDetail.version,
      lines: [
        {
          id: orderDetail.lines[0].id,
          itemId: productId,
          quantity: "2",
          listUnitPrice: "12.00",
          unitPrice: "12.00",
          taxRateId: null,
          discountPercent: "0",
          suggestedUnitPrice: null,
          pricingSourceType: null,
          pricingScheduleName: null,
          pricingBreakLabel: null,
          isPriceOverridden: false,
        },
      ],
      confirmOversell: true,
    };

    const first = await testFetch(`/api/sales-orders/${order.body.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...basePayload, notes: "first sales writer" }),
    });
    expect(first.status, await first.text()).toBe(200);

    const stale = await testFetch(`/api/sales-orders/${order.body.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...basePayload, notes: "stale sales writer" }),
    });
    const staleBody = await stale.json();
    expect(stale.status, JSON.stringify(staleBody)).toBe(409);
    expect(staleBody.conflict).toBe(true);
    expect(staleBody.current.notes).toBe("first sales writer");
    expect(staleBody.current.version).toBe(orderDetail.version + 1);
    expect(staleBody.order).toBeUndefined();
    expect(staleBody.kind).toBeUndefined();

    const [row] = await db
      .select({ notes: salesOrders.notes, version: salesOrders.version })
      .from(salesOrders)
      .where(eq(salesOrders.id, order.body.id));
    expect(row.notes).toBe("first sales writer");
    expect(row.version).toBe(orderDetail.version + 1);
  });

  test("sales order autosave keeps line edits made while the header save is in flight", async ({
    db,
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const productId = await createStockedProduct(`Inflight ${unique}`, "20");
    const customer = await createCustomer({
      name: `Fast Sales Inflight Customer ${unique}`,
    });
    expect(customer.status).toBe(201);
    const order = await createSalesOrder({
      customerId: customer.body.id,
      shipDate: isoDaysFromNow(3),
      lines: [{ itemId: productId, quantity: "2", unitPrice: "12.00" }],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const orderId = order.body.id as string;
    const notes = `SO save in flight ${unique}`;

    let delayedFirstMutation = false;
    await page.route(`**/api/sales-orders/${orderId}`, async (route) => {
      if (
        (route.request().method() === "PUT" ||
          route.request().method() === "PATCH") &&
        !delayedFirstMutation
      ) {
        delayedFirstMutation = true;
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      await route.continue();
    });

    await page.goto(`/sales/order/${orderId}`);
    const notesInput = page.getByPlaceholder("Add notes for the warehouse or customer.");
    await expect(notesInput).toBeVisible();
    await notesInput.fill(notes);
    await notesInput.blur();

    await editGridCell(page, "quantity", "7");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await page.reload();

    await expect(notesInput).toHaveValue(notes);
    await expect(
      editableGrid(page).locator('.ag-row .ag-cell[col-id="quantity"]').first(),
    ).toContainText("7");

    const [row] = await db
      .select({ notes: salesOrders.notes })
      .from(salesOrders)
      .where(eq(salesOrders.id, orderId));
    expect(row.notes).toBe(notes);

    const [line] = await db
      .select({ quantity: salesOrderLines.quantity })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, orderId));
    expect(line.quantity).toBe("7.0000");
  });

  test("sales order autosave preserves an unsent blank line through a header rebase", async ({
    db,
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const existingLabel = `BlankA${unique}`;
    const newLabel = `BlankB${unique}`;
    const existingProductId = await createStockedProduct(existingLabel, "20");
    const newProductId = await createStockedProduct(newLabel, "20");
    const newProductName = `Fast Sales ${newLabel} Product ${ts}`;
    const customer = await createCustomer({
      name: `Fast Sales Blank Line Customer ${unique}`,
    });
    expect(customer.status).toBe(201);
    const order = await createSalesOrder({
      customerId: customer.body.id,
      shipDate: isoDaysFromNow(3),
      lines: [{ itemId: existingProductId, quantity: "2", unitPrice: "12.00" }],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const orderId = order.body.id as string;
    const notes = `blank line survives rebase ${unique}`;

    let delayedFirstMutation = false;
    await page.route(`**/api/sales-orders/${orderId}`, async (route) => {
      if (
        (route.request().method() === "PUT" ||
          route.request().method() === "PATCH") &&
        !delayedFirstMutation
      ) {
        delayedFirstMutation = true;
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      await route.continue();
    });

    await page.goto(`/sales/order/${orderId}`);
    await expectRows(page, 1);
    await page.getByRole("button", { name: "Add line" }).click();
    await expectRows(page, 2);

    const notesInput = page.getByPlaceholder("Add notes for the warehouse or customer.");
    await notesInput.fill(notes);
    await notesInput.blur();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expectRows(page, 2);

    const afterHeaderSave = await db
      .select({ itemId: salesOrderLines.itemId })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, orderId));
    expect(afterHeaderSave).toHaveLength(1);
    expect(afterHeaderSave[0].itemId).toBe(existingProductId);

    await selectInventoryGridItem(page, 1, newProductName);
    await editGridCell(page, "quantity", "3", 1);
    // The pill still reads "Saved" from the header save during the line
    // edit's debounce window, so wait for the persisted row instead.
    await expect
      .poll(
        async () =>
          (
            await db
              .select({ id: salesOrderLines.id })
              .from(salesOrderLines)
              .where(eq(salesOrderLines.salesOrderId, orderId))
          ).length,
        { timeout: 15_000 },
      )
      .toBe(2);
    await page.reload();
    await expectRows(page, 2);

    const savedLines = await db
      .select({
        itemId: salesOrderLines.itemId,
        quantity: salesOrderLines.quantity,
        unitPrice: salesOrderLines.unitPrice,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, orderId));
    expect(savedLines).toHaveLength(2);
    expect(savedLines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemId: newProductId,
          quantity: "3.0000",
        }),
      ]),
    );
  });

  test("sales order autosave surfaces same-field conflicts without overwriting and can recover", async ({
    browser,
    page,
    db,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const productId = await createStockedProduct(`Conflict UI ${unique}`, "20");
    const customer = await createCustomer({
      name: `Fast Sales Conflict UI Customer ${unique}`,
    });
    expect(customer.status).toBe(201);
    const order = await createSalesOrder({
      customerId: customer.body.id,
      shipDate: isoDaysFromNow(3),
      lines: [{ itemId: productId, quantity: "2", unitPrice: "12.00" }],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const orderId = order.body.id as string;
    const firstWriterNotes = `first sales writer ${randomUUID()}`;
    const staleWriterNotes = `stale sales writer ${randomUUID()}`;
    const resolvedNotes = `resolved sales writer ${randomUUID()}`;

    const secondContext = await browser.newContext({
      baseURL: getBaseUrl(),
      storageState: buildStorageState(getSessionCookie(), getBaseUrl()),
    });
    const secondPage = await secondContext.newPage();

    try {
      await page.goto(`/sales/order/${orderId}`);
      await secondPage.goto(`/sales/order/${orderId}`);

      const firstNotes = secondPage.getByPlaceholder(
        "Add notes for the warehouse or customer.",
      );
      await expect(firstNotes).toHaveValue("");
      await firstNotes.fill(firstWriterNotes);
      await firstNotes.blur();
      await expect(secondPage.getByText("Saved", { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      const staleNotes = page.getByPlaceholder(
        "Add notes for the warehouse or customer.",
      );
      await expect(staleNotes).toHaveValue("");
      await staleNotes.fill(staleWriterNotes);
      await staleNotes.blur();
      await expect(
        page.getByText(
          "This record was changed elsewhere. Saving again will overwrite those changes.",
          { exact: true },
        ),
      ).toBeVisible({ timeout: 15_000 });

      const [afterConflict] = await db
        .select({ notes: salesOrders.notes, version: salesOrders.version })
        .from(salesOrders)
        .where(eq(salesOrders.id, orderId));
      expect(afterConflict.notes).toBe(firstWriterNotes);
      expect(afterConflict.version).toBe(2);

      await staleNotes.fill(resolvedNotes);
      await staleNotes.blur();
      await expect(page.getByText("Saved", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await page.reload();
      await expect(
        page.getByPlaceholder("Add notes for the warehouse or customer."),
      ).toHaveValue(resolvedNotes);

      const [afterRecovery] = await db
        .select({ notes: salesOrders.notes, version: salesOrders.version })
        .from(salesOrders)
        .where(eq(salesOrders.id, orderId));
      expect(afterRecovery.notes).toBe(resolvedNotes);
      expect(afterRecovery.version).toBe(3);
    } finally {
      await secondContext.close();
    }
  });

  test("customer autosave rebase preserves an unsent blank contact row", async ({
    page,
  }) => {
    const customer = await createCustomer({
      name: `Fast Contact Blank Customer ${Date.now()}`,
      email: "before@example.com",
    });
    expect(customer.status, JSON.stringify(customer.body)).toBe(201);
    const customerId = customer.body.id as string;
    const contact = await addCustomerContact(customerId, {
      name: "Existing Contact",
      email: "existing@example.com",
    });
    expect(contact.status, JSON.stringify(contact.body)).toBe(200);
    const email = `blank-${Date.now()}@example.com`;
    let delayedFirstSave = false;

    await page.route(`**/api/customers/${customerId}`, async (route) => {
      if (route.request().method() === "PUT" && !delayedFirstSave) {
        delayedFirstSave = true;
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      await route.continue();
    });

    await page.goto(`/sales/customers/${customerId}`);
    await expectRows(page, 1);
    await page.getByRole("button", { name: "Add contact" }).click();
    await expectRows(page, 2);

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Email").blur();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expectRows(page, 2);

    const saved = await (await testFetch(`/api/customers/${customerId}`)).json();
    expect(saved.email).toBe(email);
    expect(saved.contacts).toHaveLength(1);
  });

  test("customer immediate reload keeps a just-blurred scalar autosave", async ({
    page,
    db,
  }) => {
    const customer = await createCustomer({
      name: `Fast Customer Reload ${Date.now()}`,
      email: "before@example.com",
    });
    expect(customer.status, JSON.stringify(customer.body)).toBe(201);
    const customerId = customer.body.id as string;
    const email = `reload-${randomUUID()}@example.com`;

    await page.goto(`/sales/customers/${customerId}`);
    const emailInput = page.getByLabel("Email");
    await expect(emailInput).toHaveValue("before@example.com");
    await emailInput.fill(email);
    await emailInput.blur();
    await page.reload();

    await expect(page.getByLabel("Email")).toHaveValue(email, { timeout: 15_000 });
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    const [savedCustomer] = await db
      .select({ email: customers.email })
      .from(customers)
      .where(eq(customers.id, customerId));
    expect(savedCustomer.email).toBe(email);
  });

  test("customer autosave keeps contact edits made while the header save is in flight", async ({
    page,
    db,
  }) => {
    const customer = await createCustomer({
      name: `Fast Contact Inflight Customer ${Date.now()}`,
      email: "before@example.com",
    });
    expect(customer.status, JSON.stringify(customer.body)).toBe(201);
    const customerId = customer.body.id as string;
    const contact = await addCustomerContact(customerId, {
      name: "Existing Contact",
      email: "existing@example.com",
    });
    expect(contact.status, JSON.stringify(contact.body)).toBe(200);
    const headerEmail = `header-${Date.now()}@example.com`;
    const contactEmail = `contact-${Date.now()}@example.com`;

    let delayedFirstPut = false;
    let markPutStarted: () => void = () => {};
    const putStarted = new Promise<void>((resolve) => {
      markPutStarted = resolve;
    });
    await page.route(`**/api/customers/${customerId}`, async (route) => {
      if (route.request().method() === "PUT" && !delayedFirstPut) {
        delayedFirstPut = true;
        markPutStarted();
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      await route.continue();
    });

    await page.goto(`/sales/customers/${customerId}`);
    await expectRows(page, 1);

    await page.getByLabel("Email").fill(headerEmail);
    await page.getByLabel("Email").blur();
    await putStarted;

    await editGridCell(page, "email", contactEmail);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await page.reload();

    await expect(page.getByLabel("Email")).toHaveValue(headerEmail);
    await expect(
      editableGrid(page).locator('.ag-row .ag-cell[col-id="email"]').first(),
    ).toContainText(contactEmail);

    const saved = await (await testFetch(`/api/customers/${customerId}`)).json();
    expect(saved.email).toBe(headerEmail);
    expect(saved.contacts).toHaveLength(1);
    expect(saved.contacts[0].email).toBe(contactEmail);

    const [savedContact] = await db
      .select({ email: customerContacts.email })
      .from(customerContacts)
      .where(eq(customerContacts.id, contact.contactId));
    expect(savedContact.email).toBe(contactEmail);
  });

  test("customer autosave surfaces same-field conflicts without overwriting and can recover", async ({
    browser,
    page,
    db,
  }) => {
    const customer = await createCustomer({
      name: `Fast Customer Conflict UI ${Date.now()}`,
      email: "before@example.com",
    });
    expect(customer.status, JSON.stringify(customer.body)).toBe(201);
    const customerId = customer.body.id as string;
    const baseVersion = customer.body.version as number;
    const firstWriterEmail = `first-${randomUUID()}@example.com`;
    const staleWriterEmail = `stale-${randomUUID()}@example.com`;
    const resolvedEmail = `resolved-${randomUUID()}@example.com`;

    const secondContext = await browser.newContext({
      baseURL: getBaseUrl(),
      storageState: buildStorageState(getSessionCookie(), getBaseUrl()),
    });
    const secondPage = await secondContext.newPage();

    try {
      await page.goto(`/sales/customers/${customerId}`);
      await secondPage.goto(`/sales/customers/${customerId}`);

      const firstEmail = secondPage.getByLabel("Email");
      await expect(firstEmail).toHaveValue("before@example.com");
      await firstEmail.fill(firstWriterEmail);
      await firstEmail.blur();
      await expect(secondPage.getByText("Saved", { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      const staleEmail = page.getByLabel("Email");
      await expect(staleEmail).toHaveValue("before@example.com");
      await staleEmail.fill(staleWriterEmail);
      await staleEmail.blur();
      await expect(
        page.getByText(
          "This record was changed elsewhere. Saving again will overwrite those changes.",
          { exact: true },
        ),
      ).toBeVisible({ timeout: 15_000 });

      const [afterConflict] = await db
        .select({ email: customers.email, version: customers.version })
        .from(customers)
        .where(eq(customers.id, customerId));
      expect(afterConflict.email).toBe(firstWriterEmail);
      expect(afterConflict.version).toBe(baseVersion + 1);

      await staleEmail.fill(resolvedEmail);
      await staleEmail.blur();
      await expect(page.getByText("Saved", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await page.reload();
      await expect(page.getByLabel("Email")).toHaveValue(resolvedEmail);

      const [afterRecovery] = await db
        .select({ email: customers.email, version: customers.version })
        .from(customers)
        .where(eq(customers.id, customerId));
      expect(afterRecovery.email).toBe(resolvedEmail);
      expect(afterRecovery.version).toBe(baseVersion + 2);
    } finally {
      await secondContext.close();
    }
  });

  test("customer create replays under the same idempotency key", async ({
    db,
  }) => {
    const email = `create-replay-${randomUUID()}@example.com`;
    const payload = {
      name: `Fast Customer Create Replay ${Date.now()}`,
      customerCategoryId: null,
      email,
      phone: null,
      billingLine1: null,
      billingLine2: null,
      billingCity: null,
      billingRegion: null,
      billingPostcode: null,
      billingCountry: null,
      shipLine1: null,
      shipLine2: null,
      shipCity: null,
      shipRegion: null,
      shipPostcode: null,
      shipCountry: null,
      contacts: [],
    };
    const postCreate = () =>
      testFetch("/api/customers", {
        method: "POST",
        headers: {
          "Idempotency-Key": `fast-customer-create-replay:${email}`,
        },
        body: JSON.stringify(payload),
      });

    const first = await postCreate();
    const firstBody = await first.json();
    expect(first.status, JSON.stringify(firstBody)).toBe(201);

    const replay = await postCreate();
    const replayBody = await replay.json();
    expect(replay.status, JSON.stringify(replayBody)).toBe(201);
    expect(replayBody.id).toBe(firstBody.id);

    const rows = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.email, email));
    expect(rows).toHaveLength(1);
  });

  test("customer stale save returns the shared conflict envelope with the fresh customer", async ({
    db,
  }) => {
    const customer = await createCustomer({
      name: `Fast Customer Conflict ${Date.now()}`,
      email: "before@example.com",
    });
    expect(customer.status, JSON.stringify(customer.body)).toBe(201);
    const customerId = customer.body.id as string;

    const detailResponse = await testFetch(`/api/customers/${customerId}`);
    expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json();
    const basePayload = {
      name: detail.name,
      customerCategoryId: detail.customerCategoryId,
      accountState: detail.accountState,
      accountPriority: detail.accountPriority,
      email: detail.email,
      phone: detail.phone,
      billingLine1: detail.billingLine1,
      billingLine2: detail.billingLine2,
      billingCity: detail.billingCity,
      billingRegion: detail.billingRegion,
      billingPostcode: detail.billingPostcode,
      billingCountry: detail.billingCountry,
      shipLine1: detail.shipLine1,
      shipLine2: detail.shipLine2,
      shipCity: detail.shipCity,
      shipRegion: detail.shipRegion,
      shipPostcode: detail.shipPostcode,
      shipCountry: detail.shipCountry,
      contacts: [],
      expectedVersion: detail.version,
    };

    const first = await testFetch(`/api/customers/${customerId}`, {
      method: "PUT",
      body: JSON.stringify({ ...basePayload, email: "first-customer@example.com" }),
    });
    expect(first.status, await first.text()).toBe(200);

    const stale = await testFetch(`/api/customers/${customerId}`, {
      method: "PUT",
      body: JSON.stringify({ ...basePayload, email: "stale-customer@example.com" }),
    });
    const staleBody = await stale.json();
    expect(stale.status, JSON.stringify(staleBody)).toBe(409);
    expect(staleBody.conflict).toBe(true);
    expect(staleBody.current.email).toBe("first-customer@example.com");
    expect(staleBody.current.version).toBe(detail.version + 1);
    expect(staleBody.customer).toBeUndefined();
    expect(staleBody.kind).toBeUndefined();

    const [row] = await db
      .select({ email: customers.email, version: customers.version })
      .from(customers)
      .where(eq(customers.id, customerId));
    expect(row.email).toBe("first-customer@example.com");
    expect(row.version).toBe(detail.version + 1);
  });

  test("sales order duplicate replays under the same idempotency key", async ({
    db,
  }) => {
    const productId = await createStockedProduct("DuplicateNumber", "10");
    const customer = await createCustomer({
      name: `Fast Duplicate Number Customer ${ts}`,
    });
    expect(customer.status).toBe(201);

    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderNumber: `SO-1182_${ts}`,
      orderDate: "2026-05-01",
      shipDate: "2026-05-02",
      lines: [{ itemId: productId, quantity: "2", unitPrice: "12.00" }],
    });
    expect(order.status).toBe(201);

    const duplicateKey = `duplicate-number-${ts}`;
    const duplicate = await testFetch(`/api/sales-orders/${order.body.id}/duplicate`, {
      method: "POST",
      headers: { "Idempotency-Key": duplicateKey },
    });
    expect(duplicate.status).toBe(201);

    const duplicatedOrder = (await duplicate.json()) as { id: string };
    const replay = await testFetch(`/api/sales-orders/${order.body.id}/duplicate`, {
      method: "POST",
      headers: { "Idempotency-Key": duplicateKey },
    });
    const duplicateReplay = (await replay.json()) as { id: string };
    expect(replay.status, JSON.stringify(duplicateReplay)).toBe(201);
    expect(duplicateReplay.id).toBe(duplicatedOrder.id);

    const [row] = await db
      .select({ orderNumber: salesOrders.orderNumber })
      .from(salesOrders)
      .where(eq(salesOrders.id, duplicatedOrder.id));

    expect(row.orderNumber).toBe(
      `SO-1182_${ts}`.slice(0, 32 - "_COPY".length) + "_COPY"
    );

    const copiedRows = await db
      .select({ id: salesOrders.id })
      .from(salesOrders)
      .where(eq(salesOrders.orderNumber, row.orderNumber));
    expect(copiedRows).toHaveLength(1);
  });

  test("sales order duplicate action flushes dirty autosave before cloning", async ({
    db,
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const productId = await createStockedProduct(`DupUI${unique}`, "10");
    const customer = await createCustomer({
      name: `Fast Duplicate UI Customer ${unique}`,
    });
    expect(customer.status).toBe(201);

    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-01",
      shipDate: "2026-05-02",
      lines: [{ itemId: productId, quantity: "2", unitPrice: "12.00" }],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const orderId = order.body.id as string;
    const notes = `dirty sales duplicate notes ${unique}`;

    await page.goto(`/sales/order/${orderId}`);
    const notesInput = page.getByPlaceholder("Add notes for the warehouse or customer.");
    await expect(notesInput).toBeVisible();
    await notesInput.fill(notes);

    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await page.waitForURL((url) => {
      return (
        url.pathname.startsWith("/sales/order/") &&
        url.pathname !== `/sales/order/${orderId}`
      );
    });
    const duplicatedId = page.url().split("/").pop();
    expect(duplicatedId).toBeTruthy();
    expect(duplicatedId).not.toBe(orderId);

    const rows = await db
      .select({
        id: salesOrders.id,
        notes: salesOrders.notes,
        customerId: salesOrders.customerId,
      })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.customerId, customer.body.id),
          eq(salesOrders.notes, notes),
        ),
      );
    expect(rows.map((row) => row.id).sort()).toEqual(
      [orderId, duplicatedId as string].sort(),
    );

    const lines = await db
      .select({
        salesOrderId: salesOrderLines.salesOrderId,
        itemId: salesOrderLines.itemId,
        quantity: salesOrderLines.quantity,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.itemId, productId));
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          salesOrderId: orderId,
          quantity: "2.0000",
        }),
        expect.objectContaining({
          salesOrderId: duplicatedId,
          quantity: "2.0000",
        }),
      ]),
    );
  });

  test("sales order status transition blocks when autosave is invalid", async ({
    db,
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const productId = await createStockedProduct(`StatusBlock${unique}`, "10");
    const customer = await createCustomer({
      name: `Fast Status Block Customer ${unique}`,
    });
    expect(customer.status).toBe(201);

    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-01",
      shipDate: "2026-05-02",
      lines: [{ itemId: productId, quantity: "2", unitPrice: "12.00" }],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const orderId = order.body.id as string;
    const invalidOrderNumber = `SO-${"X".repeat(40)}-${unique}`;
    let shipCalls = 0;

    await page.route(`**/api/sales-orders/${orderId}/ship`, async (route) => {
      shipCalls += 1;
      await route.fulfill({
        status: 418,
        contentType: "application/json",
        body: JSON.stringify({ error: "ship should be blocked" }),
      });
    });

    await page.goto(`/sales/order/${orderId}`);
    await page
      .locator('input[value^="SO-"]')
      .first()
      .fill(invalidOrderNumber);

    await page.getByLabel("Change status: Not shipped").click();
    await page.getByRole("menuitem", { name: "Shipped", exact: true }).click();

    await expect(page.getByRole("alert")).toHaveText(
      "Order number must be 32 characters or fewer",
    );
    await expect(page.getByLabel("Change status: Not shipped")).toBeVisible();
    expect(shipCalls).toBe(0);

    const [saved] = await db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, orderId));
    expect(saved.status).toBe("open");
  });

  test("sales order create-MO action stays reachable on an invalid dirty draft", async ({
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const productId = await createStockedProduct(`MakeReach${unique}`, "0");
    const customer = await createCustomer({
      name: `Fast Make Reachable Customer ${unique}`,
    });
    expect(customer.status).toBe(201);

    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-01",
      shipDate: "2026-05-02",
      lines: [{ itemId: productId, quantity: "2", unitPrice: "12.00" }],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const invalidOrderNumber = `SO-${"X".repeat(40)}-${unique}`;

    await page.goto(`/sales/order/${order.body.id}`);
    await page
      .locator('input[value^="SO-"]')
      .first()
      .fill(invalidOrderNumber);

    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Create manufacturing order(s)" }).click();

    await expect(
      page.getByRole("dialog", { name: "Create Manufacturing Orders" }),
    ).toBeVisible();
  });

  test("sales order create-MO action stops when autosave fails", async ({
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const productId = await createStockedProduct(`MakeFail${unique}`, "0");
    const customer = await createCustomer({
      name: `Fast Make Failed Save Customer ${unique}`,
    });
    expect(customer.status).toBe(201);

    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-01",
      shipDate: "2026-05-02",
      lines: [{ itemId: productId, quantity: "2", unitPrice: "12.00" }],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    let saveCalls = 0;

    await page.route(`**/api/sales-orders/${order.body.id}`, async (route) => {
      if (
        route.request().method() === "PUT" ||
        route.request().method() === "PATCH"
      ) {
        saveCalls += 1;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "forced autosave failure" }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto(`/sales/order/${order.body.id}`);
    const failedSave = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/sales-orders/${order.body.id}`) &&
        response.status() === 503,
    );
    await page
      .locator('input[value^="SO-"]')
      .first()
      .fill(`SO-AUTOSAVE-FAIL-${unique}`);

    await failedSave;
    await expect.poll(() => saveCalls, { timeout: 15_000 }).toBeGreaterThan(0);
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Create manufacturing order(s)" }).click();

    await expect(
      page.getByRole("dialog", { name: "Create Manufacturing Orders" }),
    ).toBeHidden();
  });

  test("sales order line production action is reachable on the card", async ({
    db,
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const productId = await createStockedProduct(`LineMake${unique}`, "0");
    const customer = await createCustomer({
      name: `Fast Line Make Customer ${unique}`,
    });
    expect(customer.status).toBe(201);

    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-01",
      shipDate: "2026-05-02",
      lines: [{ itemId: productId, quantity: "2", unitPrice: "12.00" }],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    let releaseSave!: () => void;
    const saveCanFinish = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    let saveCalls = 0;

    await page.route(`**/api/sales-orders/${order.body.id}`, async (route) => {
      if (
        route.request().method() === "PUT" ||
        route.request().method() === "PATCH"
      ) {
        saveCalls += 1;
        await saveCanFinish;
      }
      await route.continue();
    });
    await page.goto(`/sales/order/${order.body.id}`);
    await editGridCell(page, "quantity", "5");
    await expect.poll(() => saveCalls, { timeout: 15_000 }).toBeGreaterThan(0);
    await page.getByLabel("Production: Make").first().click();
    await page.getByRole("menuitem", { name: "Make to order" }).click();

    const dialog = page.getByRole("dialog", { name: "Create Manufacturing Order" });
    await expect(dialog).toBeHidden();
    releaseSave();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("cell", { name: "5", exact: true })).toBeVisible({
      timeout: 15_000,
    });

    const [line] = await db
      .select({ quantity: salesOrderLines.quantity })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id));
    expect(line.quantity).toBe("5.0000");
  });

  test("sales order line production dialog scopes open MOs to the selected line", async ({
    db,
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const component = await createItem({
      itemType: "material",
      name: `Fast Line Scope Component ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-LINE-SCOPE-COMP-${unique}-${ts}`,
      category: `Fast Sales ${ts}`,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "100",
      safetyStock: "0",
      bom: [],
    });
    expect(component.status, JSON.stringify(component.body)).toBe(201);
    const selectedProduct = await createItem({
      itemType: "product",
      name: `Fast Line Scope Selected Product ${unique}`,
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-LINE-SCOPE-SELECTED-${unique}-${ts}`,
      category: `Fast Sales ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "12.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: component.body.id, quantity: "1" }],
    });
    expect(selectedProduct.status, JSON.stringify(selectedProduct.body)).toBe(201);
    const otherProduct = await createItem({
      itemType: "product",
      name: `Fast Line Scope Other Product ${unique}`,
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-LINE-SCOPE-OTHER-${unique}-${ts}`,
      category: `Fast Sales ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "12.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: component.body.id, quantity: "1" }],
    });
    expect(otherProduct.status, JSON.stringify(otherProduct.body)).toBe(201);
    const customer = await createCustomer({
      name: `Fast Line Scope Customer ${unique}`,
    });
    expect(customer.status).toBe(201);
    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-01",
      shipDate: "2026-05-02",
      lines: [
        { itemId: selectedProduct.body.id, quantity: "2", unitPrice: "12.00" },
        { itemId: otherProduct.body.id, quantity: "3", unitPrice: "12.00" },
      ],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const lines = await db
      .select({ id: salesOrderLines.id, itemId: salesOrderLines.itemId })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id));
    const otherLine = lines.find((line) => line.itemId === otherProduct.body.id);
    expect(otherLine).toBeTruthy();
    const otherLineMo = await createManufacturingOrder({
      productId: otherProduct.body.id,
      salesOrderId: order.body.id,
      salesOrderLineId: otherLine!.id,
      plannedQuantity: "3",
      plannedDate: "2026-05-01",
      ingredients: [{ itemId: component.body.id, quantityPerUnit: "1" }],
      confirmShortage: false,
    });
    expect(otherLineMo.status, JSON.stringify(otherLineMo.body)).toBe(201);

    await page.goto(`/sales/order/${order.body.id}`);
    await page.getByLabel("Production: Make").first().click();
    await page.getByRole("menuitem", { name: "Make to order" }).click();

    const dialog = page.getByRole("dialog", { name: "Create Manufacturing Order" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("No open manufacturing orders.")).toBeVisible();
    await expect(dialog.getByText(otherLineMo.body.orderNumber)).toBeHidden();
  });

  test("sales order line production action blocks when autosave is invalid", async ({
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const productId = await createStockedProduct(`LMB${unique}`, "0");
    const customer = await createCustomer({
      name: `Fast Line Make Block Customer ${unique}`,
    });
    expect(customer.status).toBe(201);

    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-01",
      shipDate: "2026-05-02",
      lines: [{ itemId: productId, quantity: "2", unitPrice: "12.00" }],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const invalidOrderNumber = `SO-${"X".repeat(40)}-${unique}`;

    await page.goto(`/sales/order/${order.body.id}`);
    await page
      .locator('input[value^="SO-"]')
      .first()
      .fill(invalidOrderNumber);
    await page.getByLabel("Production: Make").first().click();
    await page.getByRole("menuitem", { name: "Make to order" }).click();

    await expect(
      page.getByRole("alert").filter({
        hasText: "Order number must be 32 characters or fewer",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Create Manufacturing Order" }),
    ).toBeHidden();
  });

  test("sales order accounting push blocks when autosave is invalid", async ({
    db,
    page,
  }) => {
    await withOnlyQuickBooksConnection(db, async () => {
      const unique = randomUUID().slice(0, 8);
      const productId = await createStockedProduct(`AcctBlk${unique}`, "10");
      const customer = await createCustomer({
        name: `Fast Accounting Blocked Customer ${unique}`,
      });
      expect(customer.status).toBe(201);

      const order = await createSalesOrder({
        customerId: customer.body.id,
        orderDate: "2026-05-01",
        shipDate: "2026-05-02",
        lines: [{ itemId: productId, quantity: "2", unitPrice: "12.00" }],
      });
      expect(order.status, JSON.stringify(order.body)).toBe(201);
      const invalidOrderNumber = `SO-${"X".repeat(40)}-${unique}`;
      let pushCalls = 0;

      await page.route(
        `**/api/sales-orders/${order.body.id}/accounting-push`,
        async (route) => {
          pushCalls += 1;
          await route.fulfill({
            status: 418,
            contentType: "application/json",
            body: JSON.stringify({ error: "accounting push should be blocked" }),
          });
        },
      );

      await page.goto(`/sales/order/${order.body.id}`);
      await page
        .locator('input[value^="SO-"]')
        .first()
        .fill(invalidOrderNumber);

      await page.getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: "Send invoice to QuickBooks" }).click();

      await expect(page.getByRole("alert")).toHaveText(
        "Order number must be 32 characters or fewer",
      );
      expect(pushCalls).toBe(0);
    });
  });

  test("Shopify paid-order import creates sales demand and records external order", async ({
    db,
  }) => {
    const productId = await createStockedProduct("ShopifyImport", "10");
    const customer = await createCustomer({
      name: `Fast Shopify Customer ${ts}`,
      email: `fast-shopify-${ts}@example.com`,
    });
    expect(customer.status).toBe(201);

    await db
      .insert(integrationConnections)
      .values({
        organizationId: getOrgId(),
        provider: "shopify",
        tenantId: `fast-shop-${ts}.myshopify.com`,
        tenantName: `Fast Shop ${ts}`,
        accessTokenCiphertext: "shopify-fast-token",
        refreshTokenCiphertext: "",
        tokenEncryptionKeyId: "plain",
        tokenExpiresAt: new Date("2099-01-01T00:00:00Z"),
        settings: { shopDomain: `fast-shop-${ts}.myshopify.com` },
      })
      .onConflictDoUpdate({
        target: [
          integrationConnections.organizationId,
          integrationConnections.provider,
        ],
        set: {
          tenantId: `fast-shop-${ts}.myshopify.com`,
          tenantName: `Fast Shop ${ts}`,
          accessTokenCiphertext: "shopify-fast-token",
          refreshTokenCiphertext: "",
          tokenEncryptionKeyId: "plain",
          tokenExpiresAt: new Date("2099-01-01T00:00:00Z"),
          settings: { shopDomain: `fast-shop-${ts}.myshopify.com` },
          updatedAt: new Date(),
        },
      });

    const shopifyOrderId = `fast-${ts}`;
    const server = await startShopifyServer({
      orders: [
        {
          id: shopifyOrderId,
          name: `#${ts}`,
          created_at: "2026-05-20T18:30:00Z",
          financial_status: "paid",
          fulfillment_status: null,
          email: `fast-shopify-${ts}@example.com`,
          customer: { id: `customer-${ts}` },
          shipping_address: { address1: "10 Market St" },
          line_items: [
            {
              id: `line-${ts}`,
              sku: `FAST-SALES-ShopifyImport-${ts}`,
              quantity: 2,
              fulfillable_quantity: 2,
              price: "12.00",
            },
          ],
        },
      ],
    });

    try {
      const response = await testFetch("/api/shopify/import/orders", {
        method: "POST",
        body: JSON.stringify({ shopBaseUrl: server.baseUrl }),
      });
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body).toMatchObject({ created: 1, skipped: 0, errors: [] });

      const [order] = await db
        .select({ id: salesOrders.id })
        .from(salesOrders)
        .where(eq(salesOrders.orderNumber, `SHOP-${ts}`));
      expect(order).toBeTruthy();

      const [line] = await db
        .select({ id: salesOrderLines.id, quantity: salesOrderLines.quantity })
        .from(salesOrderLines)
        .where(eq(salesOrderLines.salesOrderId, order.id));
      expect(line.quantity).toBe("2.0000");

      const [demand] = await db
        .select({ quantity: inventoryDemandSummary.quantity })
        .from(inventoryDemandSummary)
        .where(
          and(
            eq(inventoryDemandSummary.itemId, productId),
            eq(inventoryDemandSummary.referenceType, "sales_order_line"),
            eq(inventoryDemandSummary.referenceId, line.id)
          )
        );
      expect(demand.quantity).toBe("2.0000");

      const [external] = await db
        .select({ localRecordId: integrationExternalRecords.localRecordId })
        .from(integrationExternalRecords)
        .where(
          and(
            eq(integrationExternalRecords.provider, "shopify"),
            eq(integrationExternalRecords.entityType, "sales_order"),
            eq(integrationExternalRecords.externalId, shopifyOrderId)
          )
        );
      expect(external.localRecordId).toBe(order.id);
    } finally {
      await server.close();
    }
  });

  test("shipping consumes stock once and closes the order", async ({ db }) => {
    const productId = await createStockedProduct("Ship", "5");

    const customer = await createCustomer({ name: `Fast Ship Customer ${ts}` });
    expect(customer.status).toBe(201);
    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-03",
      shipDate: "2026-05-04",
      lines: [{ itemId: productId, quantity: "5", unitPrice: "15.00" }],
    });
    expect(order.status).toBe(201);

    const shipKey = `ship-once-${ts}`;
    const ship = await testFetch(`/api/sales-orders/${order.body.id}/ship`, {
      method: "POST",
      headers: { "Idempotency-Key": shipKey },
      body: JSON.stringify({}),
    });
    expect(ship.status).toBe(200);
    const replay = await testFetch(`/api/sales-orders/${order.body.id}/ship`, {
      method: "POST",
      headers: { "Idempotency-Key": shipKey },
      body: JSON.stringify({}),
    });
    expect(replay.status, await replay.text()).toBe(200);

    const events = await db
      .select({ quantity: inventoryEvents.quantity })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, productId),
          eq(inventoryEvents.eventType, "sales_consumption")
        )
      );
    expect(events).toHaveLength(1);
    expect(events[0].quantity).toBe("5.0000");

    const [lineState] = await db
      .select({
        shippedQuantity: salesOrderLines.shippedQuantity,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id));
    expect(lineState.shippedQuantity).toBe("5.0000");

    const [balance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        demandQty: inventoryItemBalances.demandQty,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, productId));
    expect(balance).toMatchObject({
      onHandQty: "0.0000",
      demandQty: "0.0000",
    });

    const [savedOrder] = await db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, order.body.id));
    expect(savedOrder.status).toBe("done");
  });

  test("partial shipping updates shipped quantity and leaves remaining demand", async ({
    db,
  }) => {
    const productId = await createStockedProduct("PartialShip", "8");

    const customer = await createCustomer({ name: `Fast Partial Ship Customer ${ts}` });
    expect(customer.status).toBe(201);
    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-03",
      shipDate: "2026-05-04",
      lines: [{ itemId: productId, quantity: "8", unitPrice: "15.00" }],
    });
    expect(order.status).toBe(201);

    const [line] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id));
    const ship = await testFetch(`/api/sales-orders/${order.body.id}/ship`, {
      method: "POST",
      headers: Object.fromEntries(createIdempotencyHeaders("shipSalesOrder").entries()),
      body: JSON.stringify({
        syncAccounting: false,
        lines: [{ salesOrderLineId: line.id, quantity: "3" }],
      }),
    });
    expect(ship.status).toBe(200);

    const [savedOrder] = await db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, order.body.id));
    expect(savedOrder.status).toBe("open");

    const [lineState] = await db
      .select({
        shippedQuantity: salesOrderLines.shippedQuantity,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id));
    expect(lineState.shippedQuantity).toBe("3.0000");

    const [balance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        demandQty: inventoryItemBalances.demandQty,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, productId));
    expect(balance).toMatchObject({
      onHandQty: "5.0000",
      demandQty: "5.0000",
    });
  });

  test("BOL selected quantities render for an open order without changing the order", async ({
    db,
  }) => {
    const productId = await createStockedProduct("Bol", "10");
    const secondProductId = await createStockedProduct("BolSecond", "10");

    const customer = await createCustomer({ name: `Fast BOL Customer ${ts}` });
    expect(customer.status).toBe(201);
    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-03",
      shipDate: "2026-05-04",
      notes: "Load from the north bay.",
      lines: [
        { itemId: productId, quantity: "10", unitPrice: "15.00" },
        { itemId: secondProductId, quantity: "5", unitPrice: "9.00" },
      ],
    });
    expect(order.status).toBe(201);

    const [line, secondLine] = await db
      .select({
        id: salesOrderLines.id,
        quantity: salesOrderLines.quantity,
        shippedQuantity: salesOrderLines.shippedQuantity,
        cancelledQuantity: salesOrderLines.cancelledQuantity,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id))
      .orderBy(asc(salesOrderLines.sortOrder));
    expect(line).toBeTruthy();
    expect(secondLine).toBeTruthy();

    const selectedResponse = await testFetch(
      `/api/sales-orders/${order.body.id}/bol?line=${line.id}:6`
    );
    expect(selectedResponse.status, await selectedResponse.text()).toBe(200);
    expect(selectedResponse.headers.get("content-type")).toContain("application/pdf");
    const selectedPdf = await selectedResponse.text();

    const explicitBothResponse = await testFetch(
      `/api/sales-orders/${order.body.id}/bol?line=${line.id}:6&line=${secondLine.id}:5`
    );
    expect(explicitBothResponse.status, await explicitBothResponse.text()).toBe(200);
    const explicitBothPdf = await explicitBothResponse.text();
    expect(selectedPdf).not.toEqual(explicitBothPdf);

    const fallbackResponse = await testFetch(`/api/sales-orders/${order.body.id}/bol`);
    expect(fallbackResponse.status, await fallbackResponse.text()).toBe(200);
    expect(fallbackResponse.headers.get("content-type")).toContain("application/pdf");
    const fallbackPdf = await fallbackResponse.text();
    expect(selectedPdf).not.toEqual(fallbackPdf);

    const overRemaining = await testFetch(
      `/api/sales-orders/${order.body.id}/bol?line=${line.id}:11`
    );
    expect(overRemaining.status).toBe(400);
    expect(await overRemaining.json()).toMatchObject({
      error: "BOL quantity cannot exceed remaining quantity.",
    });

    const [after] = await db
      .select({
        quantity: salesOrderLines.quantity,
        shippedQuantity: salesOrderLines.shippedQuantity,
        cancelledQuantity: salesOrderLines.cancelledQuantity,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.id, line.id));
    expect(after).toEqual({
      quantity: line.quantity,
      shippedQuantity: line.shippedQuantity,
      cancelledQuantity: line.cancelledQuantity,
    });
  });

  test("cancel remaining closes a partially shipped order and releases demand", async ({
    db,
  }) => {
    const productId = await createStockedProduct("ShortClose", "8");

    const customer = await createCustomer({
      name: `Fast Short Close Customer ${ts}`,
    });
    expect(customer.status).toBe(201);
    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-03",
      shipDate: "2026-05-04",
      lines: [{ itemId: productId, quantity: "8", unitPrice: "15.00" }],
    });
    expect(order.status).toBe(201);

    const [line] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id));

    const ship = await testFetch(`/api/sales-orders/${order.body.id}/ship`, {
      method: "POST",
      headers: Object.fromEntries(createIdempotencyHeaders("shipSalesOrder").entries()),
      body: JSON.stringify({
        syncAccounting: false,
        lines: [{ salesOrderLineId: line.id, quantity: "3" }],
      }),
    });
    expect(ship.status).toBe(200);

    const close = await testFetch(
      `/api/sales-orders/${order.body.id}/cancel-remaining`,
      {
        method: "POST",
        headers: Object.fromEntries(
          createIdempotencyHeaders("cancelRemainingSalesOrder").entries()
        ),
        body: JSON.stringify({}),
      }
    );
    expect(close.status, await close.text()).toBe(200);

    const [savedOrder] = await db
      .select({
        status: salesOrders.status,
        priorityRank: salesOrders.priorityRank,
        shippedAt: salesOrders.shippedAt,
      })
      .from(salesOrders)
      .where(eq(salesOrders.id, order.body.id));
    expect(savedOrder.status).toBe("done");
    expect(savedOrder.priorityRank).toBeNull();
    expect(savedOrder.shippedAt).toBeNull();

    const [lineState] = await db
      .select({
        shippedQuantity: salesOrderLines.shippedQuantity,
        cancelledQuantity: salesOrderLines.cancelledQuantity,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.id, line.id));
    expect(lineState).toMatchObject({
      shippedQuantity: "3.0000",
      cancelledQuantity: "5.0000",
    });

    const [balance] = await db
      .select({ demandQty: inventoryItemBalances.demandQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, productId));
    expect(balance.demandQty).toBe("0.0000");

    const oversizedDoneBol = await testFetch(
      `/api/sales-orders/${order.body.id}/bol?line=${line.id}:999999`
    );
    expect(oversizedDoneBol.status).toBe(400);
    expect(await oversizedDoneBol.json()).toMatchObject({
      error: "BOL quantity cannot exceed shipped quantity.",
    });

    const accountingPush = await testFetch(
      `/api/sales-orders/${order.body.id}/accounting-push`,
      {
        method: "POST",
        headers: Object.fromEntries(
          createIdempotencyHeaders("retryXeroPushForSalesOrder").entries()
        ),
        body: JSON.stringify({}),
      }
    );
    expect(accountingPush.status).toBe(409);
    expect(await accountingPush.json()).toMatchObject({
      error:
        "This order has cancelled remaining items. Review the shipped quantities before sending an accounting invoice.",
    });

    const legacyXeroPush = await testFetch(
      `/api/sales-orders/${order.body.id}/xero-push`,
      {
        method: "POST",
        headers: Object.fromEntries(
          createIdempotencyHeaders("retryXeroPushForSalesOrderLegacy").entries()
        ),
        body: JSON.stringify({}),
      }
    );
    expect(legacyXeroPush.status).toBe(409);
    expect(await legacyXeroPush.json()).toMatchObject({
      error:
        "This order has cancelled remaining items. Review the shipped quantities before sending an accounting invoice.",
    });

    const usageRows = await db
      .select({ id: billingUsageEvents.id })
      .from(billingUsageEvents)
      .where(
        and(
          eq(billingUsageEvents.organizationId, getOrgId()),
          eq(billingUsageEvents.salesOrderId, order.body.id),
          eq(billingUsageEvents.eventType, "sales_order_shipped")
        )
      );
    expect(usageRows).toHaveLength(1);
  });

  test("cancel remaining rejects orders already pushed to accounting", async ({
    db,
  }) => {
    const productId = await createStockedProduct("ShortClosePushed", "8");
    const customer = await createCustomer({
      name: `Fast Short Close Pushed Customer ${ts}`,
    });
    expect(customer.status).toBe(201);
    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-03",
      shipDate: "2026-05-04",
      lines: [{ itemId: productId, quantity: "8", unitPrice: "15.00" }],
    });
    expect(order.status).toBe(201);

    const [line] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id));
    const ship = await testFetch(`/api/sales-orders/${order.body.id}/ship`, {
      method: "POST",
      headers: Object.fromEntries(createIdempotencyHeaders("shipSalesOrder").entries()),
      body: JSON.stringify({
        syncAccounting: false,
        lines: [{ salesOrderLineId: line.id, quantity: "3" }],
      }),
    });
    expect(ship.status).toBe(200);

    await db.insert(accountingDocumentSyncs).values({
      organizationId: getOrgId(),
      provider: ACCOUNTING_PROVIDER_QUICKBOOKS,
      documentType: ACCOUNTING_DOCUMENT_SALES_ORDER,
      documentId: order.body.id,
      externalDocumentId: `qb-invoice-${ts}`,
      pushStatus: "pushed",
      pushedAt: new Date(),
    });

    const close = await testFetch(
      `/api/sales-orders/${order.body.id}/cancel-remaining`,
      {
        method: "POST",
        headers: Object.fromEntries(
          createIdempotencyHeaders("cancelRemainingPushedSalesOrder").entries()
        ),
        body: JSON.stringify({}),
      }
    );
    expect(close.status).toBe(409);
    expect(await close.json()).toMatchObject({
      error:
        "This order has already been pushed to accounting. Accounting history must be preserved.",
    });

    const [savedOrder] = await db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, order.body.id));
    const [lineState] = await db
      .select({ cancelledQuantity: salesOrderLines.cancelledQuantity })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.id, line.id));
    expect(savedOrder.status).toBe("open");
    expect(lineState.cancelledQuantity).toBe("0.0000");
  });

  test("cancel remaining rejects orders with linked open manufacturing orders", async ({
    db,
  }) => {
    const component = await createItem({
      itemType: "material",
      name: `Fast Sales ShortCloseMto Component ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-SALES-SHORT-CLOSE-MTO-COMP-${ts}`,
      category: `Fast Sales ${ts}`,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "100",
      safetyStock: "0",
      bom: [],
    });
    expect(component.status, JSON.stringify(component.body)).toBe(201);
    const product = await createItem({
      itemType: "product",
      name: `Fast Sales ShortCloseMto Product ${ts}`,
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-SALES-SHORT-CLOSE-MTO-${ts}`,
      category: `Fast Sales ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "12.00",
      stock: "8",
      safetyStock: "0",
      bom: [{ componentId: component.body.id, quantity: "1" }],
    });
    expect(product.status, JSON.stringify(product.body)).toBe(201);
    const productId = product.body.id as string;
    const customer = await createCustomer({
      name: `Fast Short Close MTO Customer ${ts}`,
    });
    expect(customer.status).toBe(201);
    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-03",
      shipDate: "2026-05-04",
      lines: [{ itemId: productId, quantity: "8", unitPrice: "15.00" }],
    });
    expect(order.status).toBe(201);

    const [line] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id));
    const ship = await testFetch(`/api/sales-orders/${order.body.id}/ship`, {
      method: "POST",
      headers: Object.fromEntries(createIdempotencyHeaders("shipLinkedMtoSalesOrder").entries()),
      body: JSON.stringify({
        syncAccounting: false,
        lines: [{ salesOrderLineId: line.id, quantity: "3" }],
      }),
    });
    expect(ship.status).toBe(200);

    const manufacturingOrder = await createManufacturingOrder({
      productId,
      salesOrderId: order.body.id,
      salesOrderLineId: line.id,
      plannedQuantity: "8",
      plannedDate: "2026-05-03",
      ingredients: [
        {
          itemId: component.body.id,
          defaultItemId: component.body.id,
          quantityPerUnit: "1",
        },
      ],
      confirmShortage: false,
    });
    expect(manufacturingOrder.status, JSON.stringify(manufacturingOrder.body)).toBe(
      201
    );

    const close = await testFetch(
      `/api/sales-orders/${order.body.id}/cancel-remaining`,
      {
        method: "POST",
        headers: Object.fromEntries(
          createIdempotencyHeaders("cancelRemainingLinkedMtoSalesOrder").entries()
        ),
        body: JSON.stringify({}),
      }
    );
    expect(close.status).toBe(400);
    expect(await close.json()).toMatchObject({
      error:
        "Cancel the linked manufacturing order before closing remaining sales demand.",
    });

    const [savedOrder] = await db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, order.body.id));
    const [lineState] = await db
      .select({ cancelledQuantity: salesOrderLines.cancelledQuantity })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.id, line.id));
    const [linkedOrder] = await db
      .select({ status: manufacturingOrders.status })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, manufacturingOrder.body.id));
    expect(savedOrder.status).toBe("open");
    expect(lineState.cancelledQuantity).toBe("0.0000");
    expect(linkedOrder.status).toBe("open");
  });

  test("shipping warns before taking demand-queue stock from another order", async ({
    db,
  }) => {
    const productId = await createStockedProduct("QueueShip", "50");
    const customer = await createCustomer({ name: `Fast Queue Ship Customer ${ts}` });
    expect(customer.status).toBe(201);

    const reservedOrder = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-05",
      shipDate: "2026-05-10",
      lines: [{ itemId: productId, quantity: "50", unitPrice: "15.00" }],
    });
    expect(reservedOrder.status).toBe(201);
    const shippingOrder = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-05",
      shipDate: "2026-05-06",
      lines: [{ itemId: productId, quantity: "50", unitPrice: "15.00" }],
    });
    expect(shippingOrder.status).toBe(201);

    const [reservedLine] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, reservedOrder.body.id));
    const [demand] = await db
      .select({ quantity: inventoryDemandSummary.quantity })
      .from(inventoryDemandSummary)
      .where(eq(inventoryDemandSummary.referenceId, reservedLine.id));
    expect(demand.quantity).toBe("50.0000");

    const salesOrdersResponse = await testFetch("/api/sales-orders");
    expect(salesOrdersResponse.status).toBe(200);
    const salesOrderRows = (await salesOrdersResponse.json()) as Array<{
      id: string;
      fulfillmentSummary?: { salesItemsState?: string };
    }>;
    expect(
      salesOrderRows.find((row) => row.id === reservedOrder.body.id)
        ?.fulfillmentSummary?.salesItemsState
    ).toBe("available");
    expect(
      salesOrderRows.find((row) => row.id === shippingOrder.body.id)
        ?.fulfillmentSummary?.salesItemsState
    ).toBe("not_available");

    const shippingShip = await fulfillSalesOrder(shippingOrder.body.id);
    expect(shippingShip.status).toBe(409);
    expect(shippingShip.body.negativeStock).toMatchObject({
      itemId: productId,
      reason: "queue_conflict",
      claimedByHigherPriority: 50,
    });
    expect(shippingShip.body.negativeStock.conflicts[0]).toMatchObject({
      referenceType: "sales_order",
      referenceId: reservedOrder.body.id,
      quantity: 50,
    });

    const reservedShip = await fulfillSalesOrder(reservedOrder.body.id);
    expect(reservedShip.status, JSON.stringify(reservedShip.body)).toBe(200);
  });

  test("shipping a managed line can use demand-queue available stock", async ({
    db,
  }) => {
    const productId = await createStockedProduct("ManagedQueueShip", "20");
    const customer = await createCustomer({
      name: `Fast Managed Queue Ship Customer ${ts}`,
    });
    expect(customer.status).toBe(201);

    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-07",
      shipDate: "2026-05-08",
      lines: [{ itemId: productId, quantity: "20", unitPrice: "15.00" }],
    });
    expect(order.status).toBe(201);

    const [line] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id));
    await db
      .update(salesOrderLines)
      .set({ allocationManagedAt: new Date() })
      .where(eq(salesOrderLines.id, line.id));

    const salesOrdersResponse = await testFetch("/api/sales-orders");
    expect(salesOrdersResponse.status).toBe(200);
    const salesOrderRows = (await salesOrdersResponse.json()) as Array<{
      id: string;
      fulfillmentSummary?: { salesItemsState?: string };
    }>;
    expect(
      salesOrderRows.find((row) => row.id === order.body.id)?.fulfillmentSummary
        ?.salesItemsState
    ).toBe("available");

    const ship = await fulfillSalesOrder(order.body.id);
    expect(ship.status).toBe(200);

    const [savedOrder] = await db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, order.body.id));
    expect(savedOrder.status).toBe("done");
  });

  test("shipping a lower-priority order warns before taking demand-queue stock", async () => {
    const conflictTs = Date.now().toString(36);
    const productId = await createStockedProduct(`QCS${conflictTs}`, "50");
    const customer = await createCustomer({
      name: `Fast Queue Conflict Ship Customer ${conflictTs}`,
    });
    expect(customer.status).toBe(201);

    const higherPriorityOrder = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-07",
      shipDate: "2026-05-08",
      lines: [{ itemId: productId, quantity: "50", unitPrice: "15.00" }],
    });
    expect(higherPriorityOrder.status, JSON.stringify(higherPriorityOrder.body)).toBe(
      201
    );
    const lowerPriorityOrder = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-07",
      shipDate: "2026-05-10",
      lines: [{ itemId: productId, quantity: "50", unitPrice: "15.00" }],
    });
    expect(lowerPriorityOrder.status, JSON.stringify(lowerPriorityOrder.body)).toBe(
      201
    );

    const salesOrdersResponse = await testFetch("/api/sales-orders");
    expect(salesOrdersResponse.status).toBe(200);
    const salesOrderRows = (await salesOrdersResponse.json()) as Array<{
      id: string;
      fulfillmentSummary?: { salesItemsState?: string };
    }>;
    expect(
      salesOrderRows.find((row) => row.id === higherPriorityOrder.body.id)
        ?.fulfillmentSummary?.salesItemsState
    ).toBe("available");
    expect(
      salesOrderRows.find((row) => row.id === lowerPriorityOrder.body.id)
        ?.fulfillmentSummary?.salesItemsState
    ).toBe("not_available");

    const lowerPriorityDetailResponse = await testFetch(
      `/api/sales-orders/${lowerPriorityOrder.body.id}`
    );
    expect(lowerPriorityDetailResponse.status).toBe(200);
    const lowerPriorityDetail = (await lowerPriorityDetailResponse.json()) as {
      fulfillmentSummary?: { salesItemsState?: string };
      lines?: Array<{
        fulfillmentSummary?: { salesItemsState?: string };
        demandQueueShortQty?: string;
      }>;
    };
    expect(lowerPriorityDetail.fulfillmentSummary?.salesItemsState).toBe(
      "not_available"
    );
    expect(lowerPriorityDetail.lines?.[0]?.fulfillmentSummary?.salesItemsState).toBe(
      "not_available"
    );
    expect(lowerPriorityDetail.lines?.[0]?.demandQueueShortQty).toBe("50");

    const ship = await fulfillSalesOrder(lowerPriorityOrder.body.id);
    expect(ship.status).toBe(409);
    expect(ship.body.negativeStock).toMatchObject({
      itemId: productId,
      reason: "queue_conflict",
      claimedByHigherPriority: 50,
    });
    expect(ship.body.negativeStock.conflicts[0]).toMatchObject({
      referenceType: "sales_order",
      referenceId: higherPriorityOrder.body.id,
      quantity: 50,
    });
  });

  test("shipping warns before taking future-eligible stock claimed by manufacturing", async () => {
    const conflictTs = Date.now().toString(36);
    const agedComponent = await createItem({
      itemType: "material",
      name: `Fast Aged Claim Component ${conflictTs}`,
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-AGED-CLAIM-COMP-${conflictTs}`,
      category: `Fast Sales ${conflictTs}`,
      description: null,
      defaultPurchasePrice: "7.00",
      defaultSellingPrice: "15.00",
      stock: "10",
      safetyStock: "0",
      bom: [],
    });
    expect(agedComponent.status, JSON.stringify(agedComponent.body)).toBe(201);

    const finishedProduct = await createItem({
      itemType: "product",
      name: `Fast Aged Claim Finished ${conflictTs}`,
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-AGED-CLAIM-FIN-${conflictTs}`,
      category: `Fast Sales ${conflictTs}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "25.00",
      stock: "0",
      safetyStock: "0",
      bom: [
        {
          componentId: agedComponent.body.id,
          quantity: "1",
          minimumLotAgeDays: 3,
        },
      ],
    });
    expect(finishedProduct.status, JSON.stringify(finishedProduct.body)).toBe(201);

    const manufacturingOrder = await createManufacturingOrder({
      productId: finishedProduct.body.id,
      plannedQuantity: "10",
      plannedDate: isoDaysFromNow(4),
      ingredients: [{ itemId: agedComponent.body.id, quantityPerUnit: "1" }],
      confirmShortage: false,
    });
    expect(
      manufacturingOrder.status,
      JSON.stringify(manufacturingOrder.body)
    ).toBe(201);

    const customer = await createCustomer({
      name: `Fast Aged Claim Customer ${conflictTs}`,
    });
    expect(customer.status).toBe(201);

    const salesOrder = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: isoDaysFromNow(0),
      shipDate: isoDaysFromNow(1),
      lines: [{ itemId: agedComponent.body.id, quantity: "10", unitPrice: "15.00" }],
    });
    expect(salesOrder.status, JSON.stringify(salesOrder.body)).toBe(201);

    const salesOrdersResponse = await testFetch("/api/sales-orders");
    expect(salesOrdersResponse.status).toBe(200);
    const salesOrderRows = (await salesOrdersResponse.json()) as Array<{
      id: string;
      fulfillmentSummary?: { salesItemsState?: string };
    }>;
    expect(
      salesOrderRows.find((row) => row.id === salesOrder.body.id)
        ?.fulfillmentSummary?.salesItemsState
    ).toBe("not_available");

    const ship = await fulfillSalesOrder(salesOrder.body.id);
    expect(ship.status).toBe(409);
    expect(ship.body.negativeStock).toMatchObject({
      itemId: agedComponent.body.id,
      reason: "queue_conflict",
      claimedByHigherPriority: 10,
    });
    expect(ship.body.negativeStock.conflicts[0]).toMatchObject({
      referenceType: "manufacturing_order",
      referenceId: manufacturingOrder.body.id,
      quantity: 10,
    });
  });

  test("QuickBooks invoice sync rejects taxable sales orders before external API", async ({
    db,
  }) => {
    await withOnlyQuickBooksConnection(db, async () => {
      const unique = Date.now().toString(36);
      const productId = await createStockedProduct(`QBTax${unique}`, "10");
      const customer = await createCustomer({
        name: `Fast QuickBooks Tax Customer ${unique}`,
      });
      expect(customer.status).toBe(201);
      const order = await createSalesOrder({
        customerId: customer.body.id,
        orderDate: "2026-05-09",
        shipDate: "2026-05-10",
        lines: [{ itemId: productId, quantity: "2", unitPrice: "15.00" }],
      });
      expect(order.status, JSON.stringify(order.body)).toBe(201);
      await db
        .update(salesOrderLines)
        .set({ taxRatePercent: "5" })
        .where(eq(salesOrderLines.salesOrderId, order.body.id));

      const response = await testFetch(
        `/api/sales-orders/${order.body.id}/accounting-push`,
        { method: "POST" },
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe(
        "QuickBooks tax mapping is not available yet. Remove tax from this order before sending it to QuickBooks.",
      );

      const rows = await db
        .select()
        .from(accountingDocumentSyncs)
        .where(
          and(
            eq(accountingDocumentSyncs.provider, ACCOUNTING_PROVIDER_QUICKBOOKS),
            eq(
              accountingDocumentSyncs.documentType,
              ACCOUNTING_DOCUMENT_SALES_ORDER,
            ),
            eq(accountingDocumentSyncs.documentId, order.body.id),
          ),
        );
      expect(rows).toHaveLength(0);
    });
  });

});
