import { and, eq, inArray } from "drizzle-orm";
import { filterList, test, expect } from "../fixtures";
import {
  inventoryEvents,
  purchaseOrders,
  salesOrders,
  stocktakeItems,
} from "../../../lib/db/schema";
import { buildStocktakeCategoryScope } from "../../../lib/schemas/stocktakes";
import {
  confirmSalesOrder,
  createCustomer,
  createItem,
  createPurchaseOrder,
  createSalesOrder,
  createSupplier,
  getUnitId,
  submitPurchaseOrder,
  testFetch,
} from "../../helpers/api";

test.describe("Inventory ledger explorer", () => {
  test.describe.configure({ mode: "serial" });

  const ts = Date.now();
  const unitId = getUnitId();

  const purchaseMaterialName = `Ledger Purchase Material ${ts}`;
  const supplierName = `Ledger Supplier ${ts}`;
  const salesProductName = `Ledger Sales Product ${ts}`;
  const customerName = `Ledger Customer ${ts}`;
  const stocktakeCategory = `Ledger Stocktake ${ts}`;
  const stocktakeLossMaterialName = `Ledger Stocktake Loss ${ts}`;
  const stocktakeVerifiedMaterialName = `Ledger Stocktake Verified ${ts}`;
  const stocktakeName = `Ledger Stocktake ${ts}`;

  let purchaseMaterialId = "";
  let purchaseOrderId = "";
  let purchaseOrderNumber = "";

  let salesOrderId = "";
  let salesOrderNumber = "";

  let stocktakeId = "";
  let stocktakeLossLineId = "";
  let stocktakeVerifiedLineId = "";

  test("creates shared ledger fixtures", async ({ db }) => {
    const purchaseMaterialCreate = await createItem({
      name: purchaseMaterialName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `LEDGER-PO-MAT-${ts}`,
      category: `Ledger Purchasing ${ts}`,
      description: "Ledger purchasing material",
      defaultPurchasePrice: "2.25",
      defaultSellingPrice: null,
      stock: "5",
      safetyStock: "0",
      bom: [],
    });
    expect(purchaseMaterialCreate.status).toBe(201);
    purchaseMaterialId = purchaseMaterialCreate.body.id as string;

    const supplierCreate = await createSupplier({
      name: supplierName,
      code: `LEDGER-SUP-${ts}`,
      contactName: "Casey Ledger",
      email: `ledger-${ts}@example.com`,
      paymentTerms: "Net 15",
    });
    expect(supplierCreate.status).toBe(201);

    const purchaseOrderCreate = await createPurchaseOrder({
      supplierId: supplierCreate.body.id as string,
      expectedDate: "2026-05-02",
      notes: "Ledger explorer purchase order",
      lines: [
        {
          itemId: purchaseMaterialId,
          quantityOrdered: "3",
          unitCost: "2.25",
        },
      ],
    });
    expect(purchaseOrderCreate.status).toBe(201);
    purchaseOrderId = purchaseOrderCreate.body.id as string;

    const submitOrder = await submitPurchaseOrder(purchaseOrderId);
    expect(submitOrder.status).toBe(200);

    await expect
      .poll(async () => {
        const rows = await db
          .select({ eventType: inventoryEvents.eventType })
          .from(inventoryEvents)
          .where(eq(inventoryEvents.itemId, purchaseMaterialId));
        return rows.map((row) => row.eventType).sort().join(",");
      })
      .toContain("manual_adjustment_increase");
    await expect
      .poll(async () => {
        const rows = await db
          .select({ eventType: inventoryEvents.eventType })
          .from(inventoryEvents)
          .where(eq(inventoryEvents.itemId, purchaseMaterialId));
        return rows.map((row) => row.eventType).sort().join(",");
      })
      .toContain("expected_increase");

    const [purchaseOrder] = await db
      .select({ orderNumber: purchaseOrders.orderNumber })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, purchaseOrderId));
    expect(purchaseOrder?.orderNumber).toMatch(/PO-\d{4}-\d{4}/);
    purchaseOrderNumber = purchaseOrder!.orderNumber;

    const salesProductCreate = await createItem({
      name: salesProductName,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `LEDGER-SALES-${ts}`,
      category: `Ledger Sales ${ts}`,
      description: "Ledger sales product",
      defaultPurchasePrice: null,
      defaultSellingPrice: "18.50",
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(salesProductCreate.status).toBe(201);
    const customerCreate = await createCustomer({
      name: customerName,
      email: `ledger-customer-${ts}@example.com`,
    });
    expect(customerCreate.status).toBe(201);

    const salesOrderCreate = await createSalesOrder({
      customerId: customerCreate.body.id as string,
      lines: [
        {
          itemId: salesProductCreate.body.id as string,
          quantity: "2",
          unitPrice: "18.50",
        },
      ],
      notes: "Ledger explorer sales order",
    });
    expect(salesOrderCreate.status).toBe(201);
    salesOrderId = salesOrderCreate.body.id as string;

    const confirmOrder = await confirmSalesOrder(salesOrderId, {
      confirmOversell: true,
    });
    expect(confirmOrder.status).toBe(200);

    await expect
      .poll(async () => {
        const rows = await db
          .select({ eventType: inventoryEvents.eventType })
          .from(inventoryEvents)
          .where(eq(inventoryEvents.itemId, salesProductCreate.body.id as string));
        return rows.map((row) => row.eventType).sort().join(",");
      })
      .toContain("reservation_increase");

    const [salesOrder] = await db
      .select({ orderNumber: salesOrders.orderNumber })
      .from(salesOrders)
      .where(eq(salesOrders.id, salesOrderId));
    expect(salesOrder?.orderNumber).toMatch(/SO-\d{4}-\d{4}/);
    salesOrderNumber = salesOrder!.orderNumber;

    const stocktakeLossMaterialCreate = await createItem({
      name: stocktakeLossMaterialName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `LEDGER-STK-LOSS-${ts}`,
      category: stocktakeCategory,
      description: "Ledger stocktake loss material",
      defaultPurchasePrice: "2.50",
      defaultSellingPrice: null,
      stock: "5",
      safetyStock: "0",
      bom: [],
    });
    expect(stocktakeLossMaterialCreate.status).toBe(201);

    const stocktakeVerifiedMaterialCreate = await createItem({
      name: stocktakeVerifiedMaterialName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `LEDGER-STK-VERIFY-${ts}`,
      category: stocktakeCategory,
      description: "Ledger stocktake verified material",
      defaultPurchasePrice: "3.10",
      defaultSellingPrice: null,
      stock: "2",
      safetyStock: "0",
      bom: [],
    });
    expect(stocktakeVerifiedMaterialCreate.status).toBe(201);

    const stocktakeCreate = await testFetch("/api/stocktakes", {
      method: "POST",
      body: JSON.stringify({
        name: stocktakeName,
        scope: buildStocktakeCategoryScope("material", stocktakeCategory),
        notes: "Ledger explorer stocktake",
      }),
    });
    const stocktakeBody = await stocktakeCreate.json();

    expect(stocktakeCreate.status).toBe(201);
    stocktakeId = stocktakeBody.id as string;

    const lines = await db
      .select({
        id: stocktakeItems.id,
        itemId: stocktakeItems.itemId,
      })
      .from(stocktakeItems)
      .where(eq(stocktakeItems.stocktakeId, stocktakeId));

    stocktakeLossLineId =
      lines.find((line) => line.itemId === stocktakeLossMaterialCreate.body.id)?.id ?? "";
    stocktakeVerifiedLineId =
      lines.find((line) => line.itemId === stocktakeVerifiedMaterialCreate.body.id)?.id ?? "";

    expect(stocktakeLossLineId).not.toBe("");
    expect(stocktakeVerifiedLineId).not.toBe("");

    const saveCounts = await testFetch(`/api/stocktakes/${stocktakeId}`, {
      method: "PUT",
      body: JSON.stringify({
        lines: [
          {
            lineId: stocktakeLossLineId,
            countedQty: "3",
          },
          {
            lineId: stocktakeVerifiedLineId,
            countedQty: "2",
          },
        ],
      }),
    });
    expect(saveCounts.status).toBe(200);

    const completeStocktake = await testFetch(
      `/api/stocktakes/${stocktakeId}/complete`,
      {
        method: "POST",
        body: JSON.stringify({ confirmStale: false }),
      }
    );
    expect(completeStocktake.status).toBe(200);

    await expect
      .poll(async () => {
        const rows = await db
          .select({ eventType: inventoryEvents.eventType })
          .from(inventoryEvents)
          .where(
            and(
              eq(inventoryEvents.referenceType, "stocktake_line"),
              inArray(inventoryEvents.referenceId, [
                stocktakeLossLineId,
                stocktakeVerifiedLineId,
              ])
            )
          );
        return rows.map((row) => row.eventType).sort().join(",");
      })
      .toContain("stocktake_loss");
    await expect
      .poll(async () => {
        const rows = await db
          .select({ eventType: inventoryEvents.eventType })
          .from(inventoryEvents)
          .where(
            and(
              eq(inventoryEvents.referenceType, "stocktake_line"),
              inArray(inventoryEvents.referenceId, [
                stocktakeLossLineId,
                stocktakeVerifiedLineId,
              ])
            )
          );
        return rows.map((row) => row.eventType).sort().join(",");
      })
      .toContain("stocktake_verification");
  });

  test("keeps the global ledger stock-only by default and applies event-class filters", async ({
    page,
  }) => {
    await page.goto("/inventory/ledger");
    await filterList(page, "Search ledger", purchaseMaterialName);
    await Promise.all([
      page.waitForURL(
        (url) =>
          url.pathname === "/inventory/ledger" &&
          url.searchParams.get("q") === purchaseMaterialName
      ),
      page.getByRole("button", { name: "Apply Filters" }).click(),
    ]);

    const globalTableBody = page.locator("tbody");
    await expect(globalTableBody.getByText("Manual stock increase")).toBeVisible();
    await expect(globalTableBody.getByText("Expected supply increase")).toHaveCount(0);

    await page.getByLabel("Filter by event class").click();
    await page.getByRole("option", { name: "Expected" }).click();

    await Promise.all([
      page.waitForURL(
        (url) =>
          url.pathname === "/inventory/ledger" &&
          url.searchParams.get("q") === purchaseMaterialName &&
          url.searchParams.get("eventClass") === "expected" &&
          url.searchParams.get("scope") === "all"
      ),
      page.getByRole("button", { name: "Apply Filters" }).click(),
    ]);

    await expect(globalTableBody.getByText("Expected supply increase")).toBeVisible();
    await expect(globalTableBody.getByText("Manual stock increase")).toHaveCount(0);
  });

  test("shows full item activity when deep-linking from item detail", async ({ page }) => {
    await page.goto(`/inventory/materials/${purchaseMaterialId}`);
    const viewFullLedgerLink = page.getByRole("link", { name: "View Full Ledger" });
    await expect(viewFullLedgerLink).toBeVisible();
    await viewFullLedgerLink.click();
    await expect(page).toHaveURL(new RegExp(`/inventory/ledger\\?itemId=${purchaseMaterialId}`));

    const itemTableBody = page.locator("tbody");
    await expect(itemTableBody.getByText("Manual stock increase")).toBeVisible();
    await expect(itemTableBody.getByText("Expected supply increase")).toBeVisible();

    const expectedSupplyRow = itemTableBody
      .locator("tr")
      .filter({ hasText: "Expected supply increase" })
      .first();
    await expectedSupplyRow.getByRole("button", { name: "Expand row" }).click();
    await expect(page.getByRole("link", { name: "View Source" })).toBeVisible();
  });

  test("drills through from purchase and sales order detail pages", async ({ page }) => {
    await page.goto(`/purchasing/orders/${purchaseOrderId}`);
    await page.getByRole("button", { name: "More actions" }).click();
    const purchaseLedgerItem = page.getByRole("menuitem", {
      name: "View inventory activity",
    });
    await expect(purchaseLedgerItem).toBeVisible();
    await Promise.all([
      page.waitForURL(
        (url) =>
          url.pathname === "/inventory/ledger" &&
          url.searchParams.get("documentType") === "purchase_order" &&
          url.searchParams.get("documentId") === purchaseOrderId,
        { timeout: 15_000 }
      ),
      purchaseLedgerItem.click(),
    ]);

    const purchaseTableBody = page.locator("tbody");
    await expect(purchaseTableBody.getByText("Expected supply increase")).toBeVisible();
    await expect(purchaseTableBody.getByText("Manual stock increase")).toHaveCount(0);
    await expect(purchaseTableBody.getByText(purchaseOrderNumber)).toBeVisible();

    await page.goto(`/sales/orders/${salesOrderId}`);
    await page.getByRole("button", { name: "More actions" }).click();
    const salesLedgerItem = page.getByRole("menuitem", {
      name: "View inventory activity",
    });
    await expect(salesLedgerItem).toBeVisible();
    await Promise.all([
      page.waitForURL(
        (url) =>
          url.pathname === "/inventory/ledger" &&
          url.searchParams.get("documentType") === "sales_order" &&
          url.searchParams.get("documentId") === salesOrderId,
        { timeout: 15_000 }
      ),
      salesLedgerItem.click(),
    ]);

    const salesTableBody = page.locator("tbody");
    await expect(salesTableBody.getByText("Reservation increase")).toBeVisible();
    await expect(salesTableBody.getByText("Manual stock increase")).toHaveCount(0);
    await expect(salesTableBody.getByText(salesOrderNumber)).toBeVisible();
  });

  test("returns stocktake rows from the ledger API using stocktake-line resolution", async () => {
    const response = await testFetch(
      `/api/inventory-ledger?documentType=stocktake&documentId=${stocktakeId}`
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.resolvedFilters.documentLabel).toBe(stocktakeName);
    expect(body.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "stocktake_loss",
          referenceType: "stocktake_line",
          sourceDocument: expect.objectContaining({
            type: "stocktake",
            id: stocktakeId,
          }),
        }),
        expect.objectContaining({
          eventType: "stocktake_verification",
          referenceType: "stocktake_line",
          sourceDocument: expect.objectContaining({
            type: "stocktake",
            id: stocktakeId,
          }),
        }),
      ])
    );
    expect(
      body.rows.every((row: { referenceId: string }) =>
        [stocktakeLossLineId, stocktakeVerifiedLineId].includes(row.referenceId)
      )
    ).toBe(true);
  });

  test("shows stocktake activity in the UI drill-through", async ({ page }) => {
    await page.goto(`/inventory/stocktakes/${stocktakeId}`);
    await page.getByRole("button", { name: "More actions" }).click();
    const stocktakeLedgerItem = page.getByRole("menuitem", {
      name: "View inventory activity",
    });
    await expect(stocktakeLedgerItem).toBeVisible();
    await Promise.all([
      page.waitForURL(
        (url) =>
          url.pathname === "/inventory/ledger" &&
          url.searchParams.get("documentType") === "stocktake" &&
          url.searchParams.get("documentId") === stocktakeId,
        { timeout: 15_000 }
      ),
      stocktakeLedgerItem.click(),
    ]);

    const stocktakeTableBody = page.locator("tbody");
    await expect(stocktakeTableBody.getByText("Stocktake loss", { exact: true })).toBeVisible();
    await expect(
      stocktakeTableBody.getByText("Stocktake verification", { exact: true })
    ).toBeVisible();
    await expect(
      stocktakeTableBody.getByRole("link", { name: stocktakeName, exact: true })
    ).toHaveCount(2);
  });
});
