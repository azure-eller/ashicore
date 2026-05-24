import { and, asc, eq } from "drizzle-orm";
import { format } from "date-fns";
import type { Page } from "@playwright/test";
import { test, expect, filterList, getIdFromUrl } from "../fixtures";
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
  const expectedCreateDateLong = format(new Date(`${expectedCreateDate}T00:00:00`), "MMMM d, yyyy");
  const expectedEditDateLong = format(new Date(`${expectedEditDate}T00:00:00`), "MMMM d, yyyy");

  let barkId: string;
  let sandId: string;
  let supplierId: string;
  let purchaseOrderId: string;
  let purchaseOrderNumber: string;

  function purchaseOrderStatusButton(page: Page) {
    return page.getByRole("button", { name: /^Status:/ });
  }

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
    await page.goto("/purchasing/suppliers/new");
    await expect(page.getByRole("heading", { name: "New supplier" })).toBeVisible();

    await page.getByLabel("Code", { exact: true }).pressSequentially(`SUP-${ts}`, { delay: 20 });
    await page.getByLabel("Contact name", { exact: true }).pressSequentially("Jordan Mesa", { delay: 20 });
    await page.getByLabel("Payment terms", { exact: true }).pressSequentially("Net 15", { delay: 20 });
    await page.getByLabel("Email", { exact: true }).pressSequentially(`purchasing-${ts}@example.com`, {
      delay: 20,
    });
    await page.getByLabel("Phone", { exact: true }).pressSequentially("555-0215", { delay: 20 });
    await page.getByLabel("Notes", { exact: true }).pressSequentially("Primary mulch and sand vendor", {
      delay: 20,
    });

    const [createSupplierResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/api/suppliers")
      ),
      (async () => {
        const nameInput = page.getByLabel("Name", { exact: true });
        await nameInput.pressSequentially(supplierName, { delay: 20 });
        await expect(nameInput).toHaveValue(supplierName);
        await nameInput.blur();
      })(),
    ]);
    expect(createSupplierResponse.status()).toBe(201);
    await page.waitForURL(/\/purchasing\/suppliers\/[0-9a-f-]+$/);
    supplierId = getIdFromUrl(page.url());
    await expect(page.getByRole("heading", { name: supplierName })).toBeVisible();
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue(`purchasing-${ts}@example.com`);
    await expect(page.getByLabel("Contact name", { exact: true })).toHaveValue("Jordan Mesa");

    await page.reload();
    await expect(page.getByRole("heading", { name: supplierName })).toBeVisible();
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue(`purchasing-${ts}@example.com`);
    await expect(page.getByLabel("Contact name", { exact: true })).toHaveValue("Jordan Mesa");

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
    const createOrderResponse = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId,
        expectedDate: expectedCreateDate,
        shippingCost: "0",
        notes: "Rush first load, standard second load.",
        lines: [
          {
            itemId: barkId,
            quantityOrdered: "10",
            unitCost: "2.00",
          },
          {
            itemId: sandId,
            quantityOrdered: "5",
            unitCost: "1.50",
          },
        ],
      }),
    });
    expect(createOrderResponse.status).toBe(201);
    const createOrderBody = await createOrderResponse.json();
    purchaseOrderId = createOrderBody.id;
    await page.goto(`/purchasing/order/${purchaseOrderId}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/PO-\d{4}-\d{4}/);
    await expect(
      purchaseOrderStatusButton(page)
    ).toContainText(/Draft/i);
    await expect(page.getByRole("combobox", { name: "Search suppliers..." })).toHaveValue(
      new RegExp(supplierName)
    );
    await expect(page.getByText("$27.50", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(expectedCreateDateLong)).toBeVisible();
    const detailLinesGrid = page.locator('[data-slot="editable-line-data-grid"]').first();
    await expect(detailLinesGrid).toContainText(barkName);
    await expect(detailLinesGrid).toContainText(sandName);
    await expect(detailLinesGrid).toContainText("10");
    await expect(detailLinesGrid).toContainText("5");
    await expect(detailLinesGrid).toContainText("$20.00");
    await expect(detailLinesGrid).toContainText("$7.50");

    await page.reload();
    await expect(
      purchaseOrderStatusButton(page)
    ).toContainText(/Draft/i);
    await expect(page.getByRole("combobox", { name: "Search suppliers..." })).toHaveValue(
      new RegExp(supplierName)
    );
    await expect(page.locator('[data-slot="editable-line-data-grid"]').first()).toContainText(
      barkName
    );
    await expect(page.locator('[data-slot="editable-line-data-grid"]').first()).toContainText(
      sandName
    );

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
    await expect(draftRow).toContainText(/Draft/i);
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
    const updateResponse = await testFetch(`/api/purchase-orders/${purchaseOrderId}`, {
      method: "PUT",
      body: JSON.stringify({
        supplierId,
        expectedDate: expectedEditDate,
        notes: "Updated delivery window after supplier confirmation.",
        lines: [
          {
            itemId: barkId,
            quantityOrdered: "10",
            unitCost: "2.00",
          },
          {
            itemId: sandId,
            quantityOrdered: "6",
            unitCost: "1.50",
          },
        ],
      }),
    });
    expect(updateResponse.status).toBe(200);

    await page.goto(`/purchasing/order/${purchaseOrderId}`);
    await expect(
      page.getByText("Updated delivery window after supplier confirmation.")
    ).toBeVisible();
    await expect(page.getByText("$29.00", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(expectedEditDateLong)).toBeVisible();
    await expect(page.locator('[data-slot="editable-line-data-grid"]').first()).toContainText(
      "6"
    );

    await page.reload();
    await expect(
      page.getByText("Updated delivery window after supplier confirmation.")
    ).toBeVisible();
    await expect(page.getByText("$29.00", { exact: true }).first()).toBeVisible();
    await expect(page.locator('[data-slot="editable-line-data-grid"]').first()).toContainText(
      "6"
    );

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
    await page.goto(`/purchasing/order/${purchaseOrderId}`);
    await expect(page.getByRole("heading", { name: purchaseOrderNumber })).toBeVisible();

    const submitResponse = await testFetch(`/api/purchase-orders/${purchaseOrderId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "ordered" }),
    });
    expect(submitResponse.status).toBe(200);
    await page.reload();

    await expect(
      purchaseOrderStatusButton(page)
    ).toBeVisible({ timeout: 15000 });
    await expect(
      purchaseOrderStatusButton(page)
    ).toContainText(/Ordered/i);
    await expect(page.getByText(expectedEditDateLong)).toBeVisible();
    await expect(page.locator('[data-slot="editable-line-data-grid"]').first()).toContainText(
      "10"
    );
    await expect(page.locator('[data-slot="editable-line-data-grid"]').first()).toContainText(
      "6"
    );

    await page.reload();
    await expect(
      purchaseOrderStatusButton(page)
    ).toBeVisible({ timeout: 15000 });
    await expect(
      purchaseOrderStatusButton(page)
    ).toContainText(/Ordered/i);
    await expect(page.locator('[data-slot="editable-line-data-grid"]').first()).toContainText(
      "10"
    );
    await expect(page.locator('[data-slot="editable-line-data-grid"]').first()).toContainText(
      "6"
    );

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
    expect(barkDelete.body?.error ?? "").toMatch(
      /Cannot delete the last variant|purchase orders/i
    );

    const editOrderedResponse = await testFetch(`/api/purchase-orders/${purchaseOrderId}`, {
      method: "PUT",
      body: JSON.stringify({
        supplierId,
        expectedDate: expectedEditDate,
        notes: "Ordered purchase orders remain editable.",
        lines: [
          {
            itemId: barkId,
            quantityOrdered: "10",
            unitCost: "2.00",
          },
          {
            itemId: sandId,
            quantityOrdered: "6",
            unitCost: "1.50",
          },
        ],
      }),
    });
    const editOrderedBody = await editOrderedResponse.json().catch(() => null);
    expect(editOrderedResponse.status).toBe(200);
    expect(editOrderedBody?.id).toBe(purchaseOrderId);

    const editedOrderRows = await db
      .select({ notes: purchaseOrders.notes })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, purchaseOrderId));
    expect(editedOrderRows[0].notes).toBe("Ordered purchase orders remain editable.");

    const editedLines = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId))
      .orderBy(asc(purchaseOrderLines.sortOrder));
    expect(editedLines[0].quantityOrdered).toBe("10.0000");
    expect(editedLines[1].quantityOrdered).toBe("6.0000");

    await page.goto("/purchasing/orders");
    await filterList(page, "Search purchase orders", purchaseOrderNumber);
    const orderedRow = page.getByRole("row", { name: new RegExp(purchaseOrderNumber) });
    await expect(orderedRow).toContainText(/Ordered/i);
    await expect(orderedRow).toContainText("$29.00");
  });

  test("partially receives the purchase order", async ({ page, db }) => {
    const linesBeforeReceive = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId))
      .orderBy(asc(purchaseOrderLines.sortOrder));

    const partialReceiveResponse = await testFetch(
      `/api/purchase-orders/${purchaseOrderId}/receive`,
      {
        method: "POST",
        body: JSON.stringify({
          lines: [
            {
              lineId: linesBeforeReceive[0].id,
              quantityReceived: "4",
              disposition: "available",
            },
          ],
        }),
      }
    );
    expect(partialReceiveResponse.status).toBe(200);

    await page.goto(`/purchasing/order/${purchaseOrderId}`);
    await expect(
      purchaseOrderStatusButton(page)
    ).toBeVisible({ timeout: 15000 });
    await expect(
      purchaseOrderStatusButton(page)
    ).toContainText(/Partially received/i);
    const partialLinesGrid = page.locator('[data-slot="editable-line-data-grid"]').first();
    await expect(partialLinesGrid).toContainText(barkName);
    await expect(partialLinesGrid).toContainText(sandName);

    await page.reload();
    await expect(
      purchaseOrderStatusButton(page)
    ).toBeVisible({ timeout: 15000 });
    await expect(
      purchaseOrderStatusButton(page)
    ).toContainText(/Partially received/i);
    await expect(page.locator('[data-slot="editable-line-data-grid"]').first()).toContainText(
      barkName
    );

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

    const overReceiveResponse = await testFetch(
      `/api/purchase-orders/${purchaseOrderId}/receive`,
      {
        method: "POST",
        body: JSON.stringify({
          lines: [
            {
              lineId: lines[0].id,
              quantityReceived: "7",
              disposition: "available",
            },
          ],
        }),
      }
    );
    const overReceiveBody = await overReceiveResponse.json().catch(() => null);
    expect(overReceiveResponse.status).toBeGreaterThanOrEqual(400);
    expect(
      JSON.stringify(overReceiveBody?.error ?? overReceiveBody?.errors ?? {})
    ).toMatch(/remaining|ordered|receive|quantity|positive/i);

    const linesAfterRejectedOverReceive = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId))
      .orderBy(asc(purchaseOrderLines.sortOrder));
    expect(linesAfterRejectedOverReceive[0].quantityReceived).toBe("4.0000");
    expect(linesAfterRejectedOverReceive[1].quantityReceived).toBe("0.0000");

    const barkLotsAfterRejectedOverReceive = await db
      .select()
      .from(lots)
      .where(eq(lots.itemId, barkId));
    expect(barkLotsAfterRejectedOverReceive).toHaveLength(1);

    const barkMovementsAfterRejectedOverReceive = await db
      .select()
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, barkId),
          eq(inventoryEvents.referenceId, purchaseOrderId),
          eq(inventoryEvents.eventType, "purchase_receipt")
        )
      );
    expect(barkMovementsAfterRejectedOverReceive).toHaveLength(1);

    await page.goto("/purchasing/orders");
    await filterList(page, "Search purchase orders", purchaseOrderNumber);
    const partialRow = page.getByRole("row", { name: new RegExp(purchaseOrderNumber) });
    await expect(partialRow).toContainText(/Partially received/i);
  });

  test("fully receives the remaining quantities", async ({ page, db }) => {
    const linesBeforeReceive = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId))
      .orderBy(asc(purchaseOrderLines.sortOrder));
    const finalReceiveResponse = await testFetch(
      `/api/purchase-orders/${purchaseOrderId}/receive`,
      {
        method: "POST",
        body: JSON.stringify({
          lines: [
            {
              lineId: linesBeforeReceive[0].id,
              quantityReceived: "6",
              disposition: "available",
            },
            {
              lineId: linesBeforeReceive[1].id,
              quantityReceived: "6",
              disposition: "available",
            },
          ],
        }),
      }
    );
    expect(finalReceiveResponse.status).toBe(200);

    await page.goto(`/purchasing/order/${purchaseOrderId}`);
    await expect(
      purchaseOrderStatusButton(page)
    ).toBeVisible({ timeout: 15000 });
    await expect(
      purchaseOrderStatusButton(page)
    ).toContainText(/Received/i);
    const receivedLinesGrid = page.locator('[data-slot="editable-line-data-grid"]').first();
    await expect(receivedLinesGrid).toContainText("10");
    await expect(receivedLinesGrid).toContainText("6");

    await page.reload();
    await expect(
      purchaseOrderStatusButton(page)
    ).toBeVisible({ timeout: 15000 });
    await expect(
      purchaseOrderStatusButton(page)
    ).toContainText(/Received/i);
    await expect(page.locator('[data-slot="editable-line-data-grid"]').first()).toContainText(
      "10"
    );
    await expect(page.locator('[data-slot="editable-line-data-grid"]').first()).toContainText(
      "6"
    );

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

    const receiveAfterClosedResponse = await testFetch(
      `/api/purchase-orders/${purchaseOrderId}/receive`,
      {
        method: "POST",
        body: JSON.stringify({
          lines: [
            {
              lineId: lines[0].id,
              quantityReceived: "1",
              disposition: "available",
            },
          ],
        }),
      }
    );
    const receiveAfterClosedBody = await receiveAfterClosedResponse.json().catch(() => null);
    expect(receiveAfterClosedResponse.status).toBeGreaterThanOrEqual(400);
    expect(receiveAfterClosedBody?.error ?? "").toMatch(/received|closed|remaining|status/i);

    const receiveMovementsAfterClosedAttempt = await db
      .select()
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.referenceId, purchaseOrderId),
          eq(inventoryEvents.eventType, "purchase_receipt")
        )
      );
    expect(receiveMovementsAfterClosedAttempt).toHaveLength(3);

    await page.goto("/purchasing/orders");
    await filterList(page, "Search purchase orders", purchaseOrderNumber);
    const receivedRow = page.getByRole("row", { name: new RegExp(purchaseOrderNumber) });
    await expect(receivedRow).toContainText(/Received/i);
    await expect(receivedRow).toContainText("$29.00");
  });
});
