import { and, asc, eq } from "drizzle-orm";
import { format } from "date-fns";
import { test, expect, filterList, getIdFromUrl, selectDate } from "../fixtures";
import {
  inventoryEvents,
  inventoryItemBalances,
  inventoryLotBalances,
  items,
  lots,
  purchaseOrderLines,
  purchaseOrders,
  suppliers as purchasingSuppliers,
} from "../../../lib/db/schema";
import {
  createItem,
  deleteItem,
  getUnitId,
  testFetch,
} from "../../helpers/api";

test.describe("Purchasing flow", () => {
  test.describe.configure({ mode: "serial" });

  const ts = Date.now();
  const unitId = getUnitId();

  const barkName = `Purchasing Bark ${ts}`;
  const sandName = `Purchasing Sand ${ts}`;
  const supplierName = `Mesa Supply ${ts}`;
  const nextMonthFirst = new Date();
  nextMonthFirst.setMonth(nextMonthFirst.getMonth() + 1, 1);
  const nextMonthThird = new Date();
  nextMonthThird.setMonth(nextMonthThird.getMonth() + 1, 3);
  const expectedCreateDate = format(nextMonthFirst, "yyyy-MM-dd");
  const expectedEditDate = format(nextMonthThird, "yyyy-MM-dd");
  const expectedCreateDateLabel = new Date(`${expectedCreateDate}T00:00:00`).toLocaleDateString(
    "en-US"
  );
  const expectedEditDateLabel = new Date(`${expectedEditDate}T00:00:00`).toLocaleDateString(
    "en-US"
  );

  let barkId: string;
  let sandId: string;
  let supplierId: string;
  let purchaseOrderId: string;
  let purchaseOrderNumber: string;

  test("creates material fixtures for purchasing", async ({ db }) => {
    test.slow();

    expect(unitId).toBeTruthy();

    const barkCreate = await createItem({
      name: barkName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `PO-BARK-${ts}`,
      category: `Purchasing ${ts}`,
      description: "Primary purchasing test material",
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });

    expect(barkCreate.status).toBe(201);
    barkId = barkCreate.body.id;

    const sandCreate = await createItem({
      name: sandName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `PO-SAND-${ts}`,
      category: `Purchasing ${ts}`,
      description: "Secondary purchasing test material",
      defaultPurchasePrice: "1.50",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });

    expect(sandCreate.status).toBe(201);
    sandId = sandCreate.body.id;

    const rows = await db
      .select()
      .from(items)
      .where(and(eq(items.category, `Purchasing ${ts}`), eq(items.itemType, "material")));

    expect(rows).toHaveLength(2);
  });

  test("creates a supplier with all fields", async ({ page, db }) => {
    const nameInput = page.locator("#name");

    await page.goto("/purchasing/suppliers/new");
    await expect(page.getByText("Add Supplier")).toBeVisible();

    await page.locator("#code").pressSequentially(`SUP-${ts}`, { delay: 20 });
    await page.locator("#contactName").pressSequentially("Jordan Mesa", { delay: 20 });
    await page.locator("#paymentTerms").pressSequentially("Net 15", { delay: 20 });
    await page.locator("#email").pressSequentially(`purchasing-${ts}@example.com`, {
      delay: 20,
    });
    await page.locator("#phone").pressSequentially("555-0215", { delay: 20 });
    await page.locator("#supplier-billing-line1").pressSequentially("88 Supply Road", { delay: 20 });
    await page.locator("#notes").pressSequentially("Primary mulch and sand vendor", {
      delay: 20,
    });
    await nameInput.pressSequentially(supplierName, { delay: 20 });
    await expect(nameInput).toHaveValue(supplierName);

    await page.getByRole("button", { name: "Create Supplier" }).click();
    await page.waitForURL(/\/purchasing\/suppliers\/[0-9a-f-]+$/);
    supplierId = getIdFromUrl(page.url());
    await expect(page.getByRole("heading", { name: supplierName })).toBeVisible();
    await expect(page.getByText(`purchasing-${ts}@example.com`)).toBeVisible();
    await expect(page.getByText("Jordan Mesa")).toBeVisible();

    const [supplier] = await db
      .select()
      .from(purchasingSuppliers)
      .where(eq(purchasingSuppliers.id, supplierId));

    expect(supplier.name).toBe(supplierName);
    expect(supplier.code).toBe(`SUP-${ts}`);
    expect(supplier.contactName).toBe("Jordan Mesa");
    expect(supplier.paymentTerms).toBe("Net 15");
    expect(supplier.deletedAt).toBeNull();
  });

  test("creates a draft purchase order", async ({ page, db }) => {
    await page.goto("/purchasing/orders/new");
    await page.waitForURL("**/purchasing/orders/new", { timeout: 30000 });
    await expect(
      page.getByRole("heading", { name: "Add Purchase Order" })
    ).toBeVisible({ timeout: 30000 });

    const supplierInput = page.getByPlaceholder("Search suppliers...");
    await supplierInput.click();
    await supplierInput.pressSequentially(supplierName);
    await page.getByRole("option", { name: new RegExp(supplierName) }).click();

    await selectDate(page, page.locator("#expectedDate"), "2026-05-01");
    await page.locator("#notes").fill("Rush first load, standard second load.");

    const firstMaterialInput = page.getByPlaceholder("Search materials...").first();
    await firstMaterialInput.click();
    await firstMaterialInput.pressSequentially(barkName);
    await page.getByRole("option", { name: new RegExp(barkName) }).click();
    await page.getByPlaceholder("0").first().fill("10");

    await page.getByRole("button", { name: "Add Material" }).click();

    const secondRow = page.locator("tbody tr").nth(1);
    const secondMaterialInput = secondRow.getByPlaceholder("Search materials...");
    await secondMaterialInput.click();
    await secondMaterialInput.pressSequentially(sandName);
    await page.getByRole("option", { name: new RegExp(sandName) }).click();
    await secondRow.locator('input[name="lines.1.quantityOrdered"]').fill("5");

    const createOrderResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/purchase-orders")
    );
    await page.getByRole("button", { name: "Create Order" }).click();
    const createOrderResponse = await createOrderResponsePromise;
    expect(createOrderResponse.status()).toBe(201);
    const createOrderBody = await createOrderResponse.json();
    purchaseOrderId = createOrderBody.id;
    await page.goto(`/purchasing/orders/${purchaseOrderId}`);
    await expect(page.locator("main").getByText("Draft", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(supplierName)).toBeVisible();
    await expect(page.locator("dl").getByText("$27.50", { exact: true })).toBeVisible();
    await expect(page.getByText(expectedCreateDateLabel)).toBeVisible();
    const detailLinesTable = page.locator("table").first();
    await expect(detailLinesTable).toContainText(barkName);
    await expect(detailLinesTable).toContainText(sandName);
    await expect(detailLinesTable).toContainText("10");
    await expect(detailLinesTable).toContainText("5");
    await expect(detailLinesTable).toContainText("$20.00");
    await expect(detailLinesTable).toContainText("$7.50");

    const [order] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, purchaseOrderId));

    purchaseOrderNumber = order.orderNumber;

    await page.goto("/purchasing/orders");
    await filterList(page, "Search purchase orders", purchaseOrderNumber);
    const draftRow = page.getByRole("row", { name: new RegExp(purchaseOrderNumber) });
    await expect(draftRow).toContainText(supplierName);
    await expect(draftRow).toContainText("$27.50");
    await expect(draftRow).toContainText("Draft");
    await expect(draftRow).toContainText(expectedCreateDateLabel);

    expect(order.status).toBe("draft");
    expect(order.supplierName).toBe(supplierName);
    expect(order.expectedDate).toBe(expectedCreateDate);
    expect(order.totalAmount).toBe("27.5000");

    const lines = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId))
      .orderBy(asc(purchaseOrderLines.sortOrder));

    expect(lines).toHaveLength(2);
    expect(lines[0].itemId).toBe(barkId);
    expect(lines[0].quantityOrdered).toBe("10.0000");
    expect(lines[0].quantityReceived).toBe("0.0000");
    expect(lines[0].unitCost).toBe("2.0000");
    expect(lines[1].itemId).toBe(sandId);
    expect(lines[1].quantityOrdered).toBe("5.0000");
    expect(lines[1].unitCost).toBe("1.5000");
  });

  test("edits the draft purchase order", async ({ page, db }) => {
    await page.goto(`/purchasing/orders/${purchaseOrderId}`);
    await page.getByRole("link", { name: "Edit" }).click();
    await page.waitForURL(`**/purchasing/orders/${purchaseOrderId}/edit`);

    await selectDate(page, page.locator("#expectedDate"), "2026-05-03");
    await page.locator("#notes").fill("Updated delivery window after supplier confirmation.");

    const secondRow = page.locator("tbody tr").nth(1);
    await secondRow.locator('input[name="lines.1.quantityOrdered"]').fill("6");

    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.waitForURL(`**/purchasing/orders/${purchaseOrderId}`);
    await expect(page.getByText("Updated delivery window after supplier confirmation.")).toBeVisible();
    await expect(page.locator("dl").getByText("$29.00", { exact: true })).toBeVisible();
    await expect(page.getByText(expectedEditDateLabel)).toBeVisible();
    await expect(page.locator("table").first()).toContainText("6");

    const [order] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, purchaseOrderId));

    expect(order.expectedDate).toBe(expectedEditDate);
    expect(order.totalAmount).toBe("29.0000");

    const lines = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId))
      .orderBy(asc(purchaseOrderLines.sortOrder));

    expect(lines).toHaveLength(2);
    expect(lines[1].quantityOrdered).toBe("6.0000");
  });

  test("submits the purchase order and blocks active deletes", async ({ page, db }) => {
    await page.goto(`/purchasing/orders/${purchaseOrderId}`);
    await expect(page.getByRole("heading", { name: purchaseOrderNumber })).toBeVisible();

    const submitResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/purchase-orders/${purchaseOrderId}/submit`)
    );

    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByRole("dialog", { name: "Submit Purchase Order" })).toBeVisible();
    await page.getByRole("dialog", { name: "Submit Purchase Order" })
      .getByRole("button", { name: "Submit" })
      .click();
    const submitResponse = await submitResponsePromise;
    expect(submitResponse.status()).toBe(200);

    await expect(
      page.locator("main").getByText("Ordered", { exact: true }).first()
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(expectedEditDateLabel)).toBeVisible();
    await expect(page.locator("table").first()).toContainText("10");
    await expect(page.locator("table").first()).toContainText("6");

    const [order] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, purchaseOrderId));

    expect(order.status).toBe("ordered");
    expect(order.orderedAt).not.toBeNull();

    const [barkItem] = await db
      .select({ expectedQty: inventoryItemBalances.expectedQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, barkId));
    const [sandItem] = await db
      .select({ expectedQty: inventoryItemBalances.expectedQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, sandId));

    expect(barkItem?.expectedQty ?? "0.0000").toBe("10.0000");
    expect(sandItem?.expectedQty ?? "0.0000").toBe("6.0000");

    const supplierDelete = await testFetch(`/api/suppliers/${supplierId}`, {
      method: "DELETE",
    });
    const supplierBody = await supplierDelete.json().catch(() => null);

    expect(supplierDelete.status).toBe(400);
    expect(supplierBody?.error).toContain("purchase orders");

    const barkDelete = await deleteItem(barkId);
    expect(barkDelete.status).toBe(400);
    expect(barkDelete.body?.error).toContain("purchase orders");

    await page.goto("/purchasing/orders");
    await filterList(page, "Search purchase orders", purchaseOrderNumber);
    const orderedRow = page.getByRole("row", { name: new RegExp(purchaseOrderNumber) });
    await expect(orderedRow).toContainText("Ordered");
    await expect(orderedRow).toContainText("$29.00");
  });

  test("partially receives the purchase order", async ({ page, db }) => {
    await page.goto(`/purchasing/orders/${purchaseOrderId}`);
    await page.getByRole("button", { name: "Receive" }).click();

    const receiveDialog = page.getByRole("dialog", { name: "Receive Purchase Order" });
    await expect(receiveDialog).toBeVisible();

    const partialReceiveResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/purchase-orders/${purchaseOrderId}/receive`)
    );

    await receiveDialog.getByPlaceholder("0").first().fill("4");
    await receiveDialog.getByRole("button", { name: "Receive Materials" }).click();
    const partialReceiveResponse = await partialReceiveResponsePromise;
    expect(partialReceiveResponse.status()).toBe(200);

    await expect(receiveDialog).not.toBeVisible({ timeout: 15000 });
    await expect(
      page.locator("main").getByText("Partially Received", { exact: true }).first()
    ).toBeVisible({ timeout: 15000 });
    const partialLinesTable = page.locator("table").first();
    await expect(partialLinesTable).toContainText(barkName);
    await expect(partialLinesTable).toContainText("4");
    await expect(partialLinesTable).toContainText("6");
    await expect(partialLinesTable).toContainText(sandName);

    const [order] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, purchaseOrderId));
    expect(order.status).toBe("partial");

    const lines = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId))
      .orderBy(asc(purchaseOrderLines.sortOrder));

    expect(lines[0].quantityReceived).toBe("4.0000");
    expect(lines[1].quantityReceived).toBe("0.0000");

    const barkLots = await db.select().from(lots).where(eq(lots.itemId, barkId));
    expect(barkLots).toHaveLength(1);
    expect(barkLots[0].quantity).toBe("4.0000");
    const [barkLotBalance] = await db
      .select({ unitCost: inventoryLotBalances.unitCost })
      .from(inventoryLotBalances)
      .where(eq(inventoryLotBalances.lotId, barkLots[0].id));
    expect(barkLotBalance.unitCost).toBe("2.000000");

    const barkMovements = await db
      .select()
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, barkId),
          eq(inventoryEvents.referenceId, purchaseOrderId),
          eq(inventoryEvents.eventType, "purchase_receipt")
        )
      );

    expect(barkMovements).toHaveLength(1);
    expect(barkMovements[0].referenceType).toBe("purchase_order");

    const [barkItem] = await db
      .select({ expectedQty: inventoryItemBalances.expectedQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, barkId));
    const [sandItem] = await db
      .select({ expectedQty: inventoryItemBalances.expectedQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, sandId));

    expect(barkItem.expectedQty).toBe("6.0000");
    expect(sandItem.expectedQty).toBe("6.0000");

    await page.goto("/purchasing/orders");
    await filterList(page, "Search purchase orders", purchaseOrderNumber);
    const partialRow = page.getByRole("row", { name: new RegExp(purchaseOrderNumber) });
    await expect(partialRow).toContainText("Partially Received");
  });

  test("fully receives the remaining quantities", async ({ page, db }) => {
    await page.goto(`/purchasing/orders/${purchaseOrderId}`);
    await page.getByRole("button", { name: "Receive" }).click();

    const receiveDialog = page.getByRole("dialog", { name: "Receive Purchase Order" });
    await expect(receiveDialog).toBeVisible();

    const finalReceiveResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/purchase-orders/${purchaseOrderId}/receive`)
    );

    await receiveDialog.getByPlaceholder("0").first().fill("6");
    await receiveDialog.getByPlaceholder("0").nth(1).fill("6");
    await receiveDialog.getByRole("button", { name: "Receive Materials" }).click();
    const finalReceiveResponse = await finalReceiveResponsePromise;
    expect(finalReceiveResponse.status()).toBe(200);

    await expect(receiveDialog).not.toBeVisible({ timeout: 15000 });
    await expect(
      page.locator("main").getByText("Received", { exact: true }).first()
    ).toBeVisible({ timeout: 15000 });
    const receivedLinesTable = page.locator("table").first();
    await expect(receivedLinesTable).toContainText("10");
    await expect(receivedLinesTable).toContainText("6");
    await expect(receivedLinesTable).toContainText("0");

    const [order] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, purchaseOrderId));

    expect(order.status).toBe("received");
    expect(order.receivedAt).not.toBeNull();

    const lines = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId))
      .orderBy(asc(purchaseOrderLines.sortOrder));

    expect(lines[0].quantityReceived).toBe("10.0000");
    expect(lines[1].quantityReceived).toBe("6.0000");

    const barkLots = await db.select().from(lots).where(eq(lots.itemId, barkId));
    const sandLots = await db.select().from(lots).where(eq(lots.itemId, sandId));

    expect(barkLots).toHaveLength(2);
    expect(sandLots).toHaveLength(1);

    const receiveMovements = await db
      .select()
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.referenceId, purchaseOrderId),
          eq(inventoryEvents.eventType, "purchase_receipt")
        )
      );

    expect(receiveMovements).toHaveLength(3);

    const [barkItem] = await db
      .select({ expectedQty: inventoryItemBalances.expectedQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, barkId));
    const [sandItem] = await db
      .select({ expectedQty: inventoryItemBalances.expectedQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, sandId));

    expect(barkItem.expectedQty).toBe("0.0000");
    expect(sandItem.expectedQty).toBe("0.0000");

    await page.goto("/purchasing/orders");
    await filterList(page, "Search purchase orders", purchaseOrderNumber);
    const receivedRow = page.getByRole("row", { name: new RegExp(purchaseOrderNumber) });
    await expect(receivedRow).toContainText("Received");
    await expect(receivedRow).toContainText("$29.00");
  });
});
