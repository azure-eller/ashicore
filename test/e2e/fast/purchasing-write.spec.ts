import { asc, eq } from "drizzle-orm";
import { test, expect, getIdFromUrl, selectDate } from "../fixtures";
import {
  inventoryLotBalances,
  items,
  purchaseOrderAdditionalCosts,
  purchaseOrderLines,
  purchaseOrders,
  suppliers as purchasingSuppliers,
} from "../../../lib/db/schema";
import { createItem, getUnitId, testFetch } from "../../helpers/api";

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
    await page.locator("#notes").fill("Fast purchase order smoke test");

    await expect(page.getByPlaceholder("Search materials...")).toHaveCount(1);

    const firstMaterialInput = page.getByPlaceholder("Search materials...").first();
    await firstMaterialInput.click();
    await expect(page.getByPlaceholder("Search materials...")).toHaveCount(1);
    await firstMaterialInput.fill(barkName);
    await page.getByRole("option", { name: barkOptionPattern }).click();
    await expect(page.getByPlaceholder("Search materials...")).toHaveCount(2);
    await page.getByPlaceholder("0").first().fill("10");
    await page.getByPlaceholder("Address").first().click();
    await page.getByRole("option", { name: "Add new address" }).click();
    await page.locator("#po-line-ship-line1").fill("44 Test Dock");
    await page.locator("#po-line-ship-city").fill("Boulder");
    await page.locator("#po-line-ship-region").fill("CO");
    await page.locator("#po-line-ship-postcode").fill("80301");
    await page.getByRole("button", { name: "Add Address" }).click();
    await page
      .locator('input[name="lines.0.xeroPurchaseAccountCode"]')
      .fill("312");

    const secondMaterialInput = page.getByPlaceholder("Search materials...").nth(1);
    await secondMaterialInput.click();
    await expect(page.getByPlaceholder("Search materials...")).toHaveCount(2);
    await secondMaterialInput.fill(sandName);
    await page.getByRole("option", { name: sandOptionPattern }).click();
    await expect(page.getByPlaceholder("Search materials...")).toHaveCount(3);
    await page.locator('input[name="lines.1.quantityOrdered"]').fill("5");

    await expect(page.locator('input[name="additionalCosts.0.reference"]')).toBeVisible();
    await expect(
      page.locator('input[name^="additionalCosts."][name$=".amount"]')
    ).toHaveCount(1);
    await page
      .locator('input[name="additionalCosts.0.reference"]')
      .fill("Freight smoke");
    await expect(
      page.locator('input[name^="additionalCosts."][name$=".amount"]')
    ).toHaveCount(2);
    await page
      .locator('input[name="additionalCosts.0.xeroPurchaseAccountCode"]')
      .fill("400");
    await page.locator('input[name="additionalCosts.0.amount"]').fill("12.50");
    await expect(page.getByText("Additional cost allocation")).toBeVisible();
    await expect(page.getByText("Distributed to item costs")).toBeVisible();
    await expect(page.getByText("Landed unit costs")).toHaveCount(2);
    await expect(page.getByText(/\$2\.91 \//)).toHaveCount(2);
    await expect(page.getByText(/\$2\.18 \//)).toHaveCount(2);

    const [saveOrderResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          ["POST", "PUT"].includes(response.request().method()) &&
          /\/api\/purchase-orders(?:\/[0-9a-f-]+)?$/.test(response.url())
      ),
      page.getByRole("button", { name: "Create Order" }).click(),
    ]);
    expect([200, 201]).toContain(saveOrderResponse.status());
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
    expect(order.xeroPurchaseAccountCode).toBeNull();
    expect(order.shipLine1).toBeNull();
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
    expect(lines[0].shipLine1).toBe("44 Test Dock");
    expect(lines[0].shipCity).toBe("Boulder");
    expect(lines[0].shipRegion).toBe("CO");
    expect(lines[0].shipPostcode).toBe("80301");
    expect(Number(lines[0].stockUnitCost)).toBeCloseTo(2.909091, 6);
    expect(lines[1].itemId).toBe(sandId);
    expect(lines[1].quantityOrdered).toBe("5.0000");
    expect(lines[1].xeroPurchaseAccountCode).toBe("311");
    expect(Number(lines[1].stockUnitCost)).toBeCloseTo(2.181818, 6);
    expect(Number(order.totalAmount)).toBeCloseTo(40, 4);

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

  test("uses latest landed unit cost at receipt time without repricing old receipts", async ({
    db,
  }) => {
    const receiptMaterialName = `Fast Landed Receipt ${ts}`;
    const receiptMaterial = await createItem({
      name: receiptMaterialName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-LANDED-RECEIPT-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: "Receipt-time landed cost material",
      defaultPurchasePrice: "10",
      xeroPurchaseAccountCode: "313",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(receiptMaterial.status).toBe(201);

    const createResponse = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId,
        expectedDate: null,
        shippingCost: "0",
        notes: null,
        lines: [
          {
            itemId: receiptMaterial.body.id,
            quantityOrdered: "10",
            unitCost: "10",
          },
        ],
        additionalCosts: [
          {
            costType: "shipping",
            reference: "Initial freight estimate",
            distributionMethod: "by_value",
            xeroPurchaseAccountCode: null,
            amount: "100",
          },
        ],
      }),
    });
    const createBody = await createResponse.json();
    expect(createResponse.status).toBe(201);

    let [line] = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, createBody.id));
    expect(Number(line.stockUnitCost)).toBeCloseTo(20, 6);

    const submitResponse = await testFetch(
      `/api/purchase-orders/${createBody.id}/submit`,
      { method: "POST" }
    );
    expect(submitResponse.status).toBe(200);

    const updateResponse = await testFetch(`/api/purchase-orders/${createBody.id}`, {
      method: "PUT",
      body: JSON.stringify({
        supplierId,
        expectedDate: null,
        shippingCost: "0",
        notes: null,
        lines: [
          {
            itemId: receiptMaterial.body.id,
            quantityOrdered: "10",
            unitCost: "10",
          },
        ],
        additionalCosts: [
          {
            costType: "shipping",
            reference: "Final freight quote",
            distributionMethod: "by_value",
            xeroPurchaseAccountCode: null,
            amount: "200",
          },
        ],
      }),
    });
    expect(updateResponse.status).toBe(200);

    [line] = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, createBody.id));
    expect(Number(line.stockUnitCost)).toBeCloseTo(30, 6);

    const receiveResponse = await testFetch(
      `/api/purchase-orders/${createBody.id}/receive`,
      {
        method: "POST",
        body: JSON.stringify({
          lines: [{ lineId: line.id, quantityReceived: "10" }],
        }),
      }
    );
    expect(receiveResponse.status).toBe(200);

    const [receiptLot] = await db
      .select()
      .from(inventoryLotBalances)
      .where(eq(inventoryLotBalances.itemId, receiptMaterial.body.id));
    expect(Number(receiptLot.unitCost)).toBeCloseTo(30, 6);

    const legacyShippingMaterialName = `Fast Legacy Shipping ${ts}`;
    const legacyShippingMaterial = await createItem({
      name: legacyShippingMaterialName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-LEGACY-SHIPPING-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: "Legacy shipping fallback landed cost material",
      defaultPurchasePrice: "10",
      xeroPurchaseAccountCode: "315",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(legacyShippingMaterial.status).toBe(201);

    const legacyCreate = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId,
        expectedDate: null,
        shippingCost: "100",
        notes: null,
        lines: [
          {
            itemId: legacyShippingMaterial.body.id,
            quantityOrdered: "10",
            unitCost: "10",
          },
        ],
      }),
    });
    const legacyBody = await legacyCreate.json();
    expect(legacyCreate.status).toBe(201);

    const [legacyLine] = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, legacyBody.id));
    expect(Number(legacyLine.stockUnitCost)).toBeCloseTo(20, 6);

    const legacySubmit = await testFetch(
      `/api/purchase-orders/${legacyBody.id}/submit`,
      { method: "POST" }
    );
    expect(legacySubmit.status).toBe(200);

    const legacyReceive = await testFetch(
      `/api/purchase-orders/${legacyBody.id}/receive`,
      {
        method: "POST",
        body: JSON.stringify({
          lines: [{ lineId: legacyLine.id, quantityReceived: "10" }],
        }),
      }
    );
    expect(legacyReceive.status).toBe(200);

    const [legacyLot] = await db
      .select()
      .from(inventoryLotBalances)
      .where(eq(inventoryLotBalances.itemId, legacyShippingMaterial.body.id));
    expect(Number(legacyLot.unitCost)).toBeCloseTo(20, 6);

    const partialMaterialName = `Fast Landed Partial ${ts}`;
    const partialMaterial = await createItem({
      name: partialMaterialName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-LANDED-PARTIAL-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: "Partial landed cost material",
      defaultPurchasePrice: "10",
      xeroPurchaseAccountCode: "314",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(partialMaterial.status).toBe(201);

    const partialCreate = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId,
        expectedDate: null,
        shippingCost: "0",
        notes: null,
        lines: [
          {
            itemId: partialMaterial.body.id,
            quantityOrdered: "10",
            unitCost: "10",
          },
        ],
        additionalCosts: [
          {
            costType: "shipping",
            reference: "First freight quote",
            distributionMethod: "by_value",
            xeroPurchaseAccountCode: null,
            amount: "100",
          },
        ],
      }),
    });
    const partialBody = await partialCreate.json();
    expect(partialCreate.status).toBe(201);

    const [partialLine] = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, partialBody.id));

    const partialSubmit = await testFetch(
      `/api/purchase-orders/${partialBody.id}/submit`,
      { method: "POST" }
    );
    expect(partialSubmit.status).toBe(200);

    const firstReceive = await testFetch(
      `/api/purchase-orders/${partialBody.id}/receive`,
      {
        method: "POST",
        body: JSON.stringify({
          lines: [{ lineId: partialLine.id, quantityReceived: "5" }],
        }),
      }
    );
    expect(firstReceive.status).toBe(200);

    const partialUpdate = await testFetch(`/api/purchase-orders/${partialBody.id}`, {
      method: "PUT",
      body: JSON.stringify({
        supplierId,
        expectedDate: null,
        shippingCost: "0",
        notes: null,
        lines: [
          {
            itemId: partialMaterial.body.id,
            quantityOrdered: "10",
            unitCost: "10",
          },
        ],
        additionalCosts: [
          {
            costType: "shipping",
            reference: "Revised freight quote",
            distributionMethod: "by_value",
            xeroPurchaseAccountCode: null,
            amount: "300",
          },
        ],
      }),
    });
    expect(partialUpdate.status).toBe(200);

    const secondReceive = await testFetch(
      `/api/purchase-orders/${partialBody.id}/receive`,
      {
        method: "POST",
        body: JSON.stringify({
          lines: [{ lineId: partialLine.id, quantityReceived: "5" }],
        }),
      }
    );
    expect(secondReceive.status).toBe(200);

    const partialLots = await db
      .select()
      .from(inventoryLotBalances)
      .where(eq(inventoryLotBalances.itemId, partialMaterial.body.id))
      .orderBy(asc(inventoryLotBalances.receivedAt), asc(inventoryLotBalances.lotId));
    expect(partialLots).toHaveLength(2);
    expect(Number(partialLots[0].unitCost)).toBeCloseTo(20, 6);
    expect(Number(partialLots[1].unitCost)).toBeCloseTo(40, 6);

    const [partialItem] = await db
      .select()
      .from(items)
      .where(eq(items.id, partialMaterial.body.id));
    expect(Number(partialItem.currentStockUnitCost)).toBeCloseTo(30, 6);
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
    expect(duplicate.xeroPurchaseAccountCode).toBeNull();
    expect(duplicate.shipLine1).toBeNull();

    const duplicateLines = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, duplicateId))
      .orderBy(asc(purchaseOrderLines.sortOrder));
    expect(duplicateLines).toHaveLength(2);
    expect(duplicateLines[0].itemId).toBe(barkId);
    expect(duplicateLines[0].quantityOrdered).toBe("10.0000");
    expect(duplicateLines[0].xeroPurchaseAccountCode).toBe("312");
    expect(duplicateLines[0].shipLine1).toBe("44 Test Dock");
    expect(duplicateLines[0].shipCity).toBe("Boulder");
    expect(duplicateLines[0].shipRegion).toBe("CO");
    expect(duplicateLines[0].shipPostcode).toBe("80301");
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
