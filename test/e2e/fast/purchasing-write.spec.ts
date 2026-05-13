import { asc, eq } from "drizzle-orm";
import { test, expect, getIdFromUrl, selectDate } from "../fixtures";
import {
  purchaseOrderAdditionalCosts,
  purchaseOrderLines,
  purchaseOrders,
  suppliers as purchasingSuppliers,
} from "../../../lib/db/schema";
import { createItem, getUnitId } from "../../helpers/api";

test.describe("Purchasing write-path smoke", () => {
  test.describe.configure({ mode: "serial" });

  const ts = Date.now();
  const unitId = getUnitId();
  const barkName = `Fast Purchasing Bark ${ts}`;
  const sandName = `Fast Purchasing Sand ${ts}`;
  const supplierName = `Fast Supplier ${ts}`;
  let barkId = "";
  let sandId = "";
  let supplierId = "";
  let purchaseOrderId = "";

  test("creates and edits a supplier through the browser form", async ({ page, db }) => {
    await page.goto("/purchasing/suppliers/new");
    await expect(page.getByText("Add Supplier")).toBeVisible();

    await page.locator("#name").fill(supplierName);
    await page.locator("#code").fill(`FAST-SUP-${ts}`);
    await page.locator("#contactName").fill("Jordan Mesa");
    await page.locator("#paymentTerms").fill("Net 15");
    await page.locator("#email").fill(`fast-purchasing-${ts}@example.com`);
    await page.locator("#phone").fill("555-0215");
    await page.locator("#supplier-billing-line1").fill("88 Supply Road");
    await page.locator("#notes").fill("Fast supplier smoke test");

    const [createSupplierResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/api/suppliers")
      ),
      page.getByRole("button", { name: "Create Supplier" }).click(),
    ]);
    expect(createSupplierResponse.status()).toBe(201);
    await page.waitForURL(/\/purchasing\/suppliers\/[0-9a-f-]+$/);
    supplierId = getIdFromUrl(page.url());
    await expect(page.getByRole("heading", { name: supplierName })).toBeVisible();

    const [supplier] = await db
      .select()
      .from(purchasingSuppliers)
      .where(eq(purchasingSuppliers.id, supplierId));
    expect(supplier.code).toBe(`FAST-SUP-${ts}`);
    expect(supplier.contactName).toBe("Jordan Mesa");
    expect(supplier.paymentTerms).toBe("Net 15");

    await page.getByRole("link", { name: "Edit" }).click();
    await page.waitForURL(`**/purchasing/suppliers/${supplierId}/edit`);
    await page.locator("#phone").fill("555-0216");
    await page.locator("#notes").fill("Fast supplier updated");
    const updateSupplierResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        response.url().endsWith(`/api/suppliers/${supplierId}`)
    );
    await page.getByRole("button", { name: "Save Changes" }).click();
    expect((await updateSupplierResponsePromise).status()).toBe(200);
    await page.waitForURL(`**/purchasing/suppliers/${supplierId}`);

    const [updatedSupplier] = await db
      .select()
      .from(purchasingSuppliers)
      .where(eq(purchasingSuppliers.id, supplierId));
    expect(updatedSupplier.phone).toBe("555-0216");
    expect(updatedSupplier.notes).toBe("Fast supplier updated");
  });

  test("creates a draft purchase order through the browser form", async ({ page, db }) => {
    const barkOptionPattern = new RegExp(`${barkName}.*FAST-PO-BARK-${ts}`);
    const sandOptionPattern = new RegExp(`${sandName}.*FAST-PO-SAND-${ts}`);

    const barkCreate = await createItem({
      name: barkName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-PO-BARK-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: "Primary purchasing test material",
      defaultPurchasePrice: "2.00",
      xeroPurchaseAccountCode: "310",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    const sandCreate = await createItem({
      name: sandName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-PO-SAND-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: "Secondary purchasing test material",
      defaultPurchasePrice: "1.50",
      xeroPurchaseAccountCode: "311",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });

    expect(barkCreate.status).toBe(201);
    expect(sandCreate.status).toBe(201);
    barkId = barkCreate.body.id;
    sandId = sandCreate.body.id;

    await page.goto("/purchasing/orders/new");
    await expect(page.getByRole("heading", { name: "Add Purchase Order" })).toBeVisible();

    const supplierInput = page.getByPlaceholder("Search suppliers...");
    await supplierInput.click();
    await supplierInput.pressSequentially(supplierName);
    await page.getByRole("option", { name: new RegExp(supplierName) }).click();

    await selectDate(page, page.locator("#expectedDate"), "2026-05-01");
    await page.locator("#xeroPurchaseAccountCode").fill("300");
    await page.locator("#po-ship-line1").fill("44 Test Dock");
    await page.locator("#po-ship-city").fill("Boulder");
    await page.locator("#po-ship-region").fill("CO");
    await page.locator("#po-ship-postcode").fill("80301");
    await page.locator("#notes").fill("Fast purchase order smoke test");

    const firstMaterialInput = page.getByPlaceholder("Search materials...").first();
    await firstMaterialInput.click();
    await firstMaterialInput.pressSequentially(barkName);
    await page.getByRole("option", { name: barkOptionPattern }).click();
    await page.getByPlaceholder("0").first().fill("10");
    await page.getByPlaceholder("310").fill("312");

    const secondMaterialInput = page.getByPlaceholder("Search materials...").nth(1);
    await secondMaterialInput.click();
    await secondMaterialInput.pressSequentially(sandName);
    await page.getByRole("option", { name: sandOptionPattern }).click();
    await page.locator('input[name="lines.1.quantityOrdered"]').fill("5");

    await page
      .locator('input[name="additionalCosts.0.reference"]')
      .fill("Freight smoke");
    await page
      .locator('input[name="additionalCosts.0.xeroPurchaseAccountCode"]')
      .fill("400");
    await page.locator('input[name="additionalCosts.0.amount"]').fill("12.50");

    const [createOrderResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/api/purchase-orders")
      ),
      page.getByRole("button", { name: "Create Order" }).click(),
    ]);
    expect(createOrderResponse.status()).toBe(201);
    await page.waitForURL(/\/purchasing\/orders\/[0-9a-f-]+$/);
    purchaseOrderId = getIdFromUrl(page.url());
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/PO-\d{4}-\d{4}/);

    const [order] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, purchaseOrderId));
    expect(order.supplierId).toBe(supplierId);
    expect(order.supplierName).toBe(supplierName);
    expect(order.status).toBe("draft");
    expect(order.expectedDate).toBe("2026-05-01");
    expect(order.xeroPurchaseAccountCode).toBe("300");
    expect(order.shipLine1).toBe("44 Test Dock");
    expect(order.shipCity).toBe("Boulder");
    expect(order.shipRegion).toBe("CO");
    expect(order.shipPostcode).toBe("80301");
    expect(order.notes).toBe("Fast purchase order smoke test");

    const lines = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId))
      .orderBy(asc(purchaseOrderLines.sortOrder));
    expect(lines).toHaveLength(2);
    expect(lines[0].itemId).toBe(barkId);
    expect(lines[0].quantityOrdered).toBe("10.0000");
    expect(lines[0].xeroPurchaseAccountCode).toBe("312");
    expect(lines[1].itemId).toBe(sandId);
    expect(lines[1].quantityOrdered).toBe("5.0000");
    expect(lines[1].xeroPurchaseAccountCode).toBe("311");

    const additionalCosts = await db
      .select()
      .from(purchaseOrderAdditionalCosts)
      .where(eq(purchaseOrderAdditionalCosts.purchaseOrderId, purchaseOrderId));
    expect(additionalCosts).toHaveLength(1);
    expect(additionalCosts[0].costType).toBe("shipping");
    expect(additionalCosts[0].reference).toBe("Freight smoke");
    expect(additionalCosts[0].distributionMethod).toBe("by_value");
    expect(additionalCosts[0].xeroPurchaseAccountCode).toBe("400");
    expect(additionalCosts[0].amount).toBe("12.5000");
  });

  test("duplicates a purchase order from the detail actions", async ({ page, db }) => {
    await page.goto(`/purchasing/orders/${purchaseOrderId}`);
    await page.getByRole("button", { name: "More actions" }).click();

    const [duplicateResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith(`/api/purchase-orders/${purchaseOrderId}/duplicate`)
      ),
      page.getByRole("menuitem", { name: "Duplicate" }).click(),
    ]);
    expect(duplicateResponse.status()).toBe(201);
    const created = await duplicateResponse.json();
    const duplicateId = created.id as string;
    await page.waitForURL(`**/purchasing/orders/${duplicateId}`);
    expect(duplicateId).not.toBe(purchaseOrderId);

    const [duplicate] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, duplicateId));
    expect(duplicate.supplierId).toBe(supplierId);
    expect(duplicate.supplierName).toBe(supplierName);
    expect(duplicate.status).toBe("draft");
    expect(duplicate.notes).toBe("Fast purchase order smoke test");
    expect(duplicate.xeroPurchaseAccountCode).toBe("300");
    expect(duplicate.shipLine1).toBe("44 Test Dock");

    const duplicateLines = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, duplicateId))
      .orderBy(asc(purchaseOrderLines.sortOrder));
    expect(duplicateLines).toHaveLength(2);
    expect(duplicateLines[0].itemId).toBe(barkId);
    expect(duplicateLines[0].quantityOrdered).toBe("10.0000");
    expect(duplicateLines[0].xeroPurchaseAccountCode).toBe("312");
    expect(duplicateLines[1].itemId).toBe(sandId);
    expect(duplicateLines[1].quantityOrdered).toBe("5.0000");
    expect(duplicateLines[1].xeroPurchaseAccountCode).toBe("311");

    const duplicateCosts = await db
      .select()
      .from(purchaseOrderAdditionalCosts)
      .where(eq(purchaseOrderAdditionalCosts.purchaseOrderId, duplicateId));
    expect(duplicateCosts).toHaveLength(1);
    expect(duplicateCosts[0].xeroPurchaseAccountCode).toBe("400");
  });
});
