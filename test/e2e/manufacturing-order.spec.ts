import fs from "node:fs";
import { eq } from "drizzle-orm";
import { test, expect } from "./fixtures";
import {
  items,
  lots,
  manufacturingOrderIngredients,
  manufacturingOrders,
  salesOrderLines,
  salesOrders,
  stockMovements,
} from "../../lib/db/schema";
import {
  createItem,
  deleteItem,
  getUnitId,
  testFetch,
  updateItem,
} from "../helpers/api";

const env = JSON.parse(fs.readFileSync("test/.test-env.json", "utf-8"));
const SESSION_COOKIE = env.TEST_SESSION_COOKIE;

function parseCookie(raw: string) {
  const [name, ...rest] = raw.split("=");
  return { name, value: rest.join("=") };
}

async function createCustomer(name: string) {
  const response = await testFetch("/api/customers", {
    method: "POST",
    body: JSON.stringify({
      name,
      email: null,
      phone: null,
      address: null,
      notes: null,
    }),
  });
  const body = await response.json().catch(() => null);

  expect(response.status).toBe(201);
  expect(body?.id).toBeTruthy();

  return body.id as string;
}

async function createSalesOrder(payload: {
  customerId: string;
  itemId: string;
  quantity: string;
  unitPrice: string;
  requestedDate?: string | null;
  notes?: string | null;
}) {
  const response = await testFetch("/api/sales-orders", {
    method: "POST",
    body: JSON.stringify({
      customerId: payload.customerId,
      status: "draft",
      requestedDate: payload.requestedDate ?? null,
      notes: payload.notes ?? null,
      lines: [
        {
          itemId: payload.itemId,
          quantity: payload.quantity,
          unitPrice: payload.unitPrice,
        },
      ],
      confirmOversell: false,
    }),
  });
  const body = await response.json().catch(() => null);

  expect(response.status).toBe(201);
  expect(body?.id).toBeTruthy();

  return body.id as string;
}

async function updateSalesOrder(payload: {
  salesOrderId: string;
  customerId: string;
  itemId: string;
  quantity: string;
  unitPrice: string;
  requestedDate?: string | null;
  notes?: string | null;
}) {
  const response = await testFetch(`/api/sales-orders/${payload.salesOrderId}`, {
    method: "PUT",
    body: JSON.stringify({
      customerId: payload.customerId,
      status: "draft",
      requestedDate: payload.requestedDate ?? null,
      notes: payload.notes ?? null,
      lines: [
        {
          itemId: payload.itemId,
          quantity: payload.quantity,
          unitPrice: payload.unitPrice,
        },
      ],
      confirmOversell: false,
    }),
  });
  const body = await response.json().catch(() => null);

  expect(response.status).toBe(200);
  expect(body?.id).toBe(payload.salesOrderId);
}

async function createManufacturingOrder(payload: {
  productId: string;
  plannedQuantity: string;
  notes?: string | null;
  ingredients: Array<{ itemId: string; quantityPerUnit: string }>;
}) {
  const response = await testFetch("/api/manufacturing-orders", {
    method: "POST",
    body: JSON.stringify({
      productId: payload.productId,
      salesOrderId: null,
      salesOrderLineId: null,
      plannedQuantity: payload.plannedQuantity,
      plannedDate: null,
      notes: payload.notes ?? null,
      ingredients: payload.ingredients,
      confirmShortage: false,
    }),
  });
  const body = await response.json().catch(() => null);

  expect(response.status).toBe(201);
  expect(body?.id).toBeTruthy();

  return body.id as string;
}

async function releaseManufacturingOrder(orderId: string) {
  const response = await testFetch(`/api/manufacturing-orders/${orderId}/release`, {
    method: "POST",
    body: JSON.stringify({ confirmShortage: false }),
  });
  const body = await response.json().catch(() => null);

  expect(response.status).toBe(200);
  expect(body?.id).toBe(orderId);
}

async function completeManufacturingOrder(orderId: string, actualQuantity: string) {
  const response = await testFetch(`/api/manufacturing-orders/${orderId}/complete`, {
    method: "POST",
    body: JSON.stringify({ actualQuantity }),
  });
  const body = await response.json().catch(() => null);

  return { status: response.status, body };
}

test.beforeEach(async ({ context }) => {
  const { name, value } = parseCookie(SESSION_COOKIE);
  await context.addCookies([{ name, value, domain: "localhost", path: "/" }]);
});

test.describe("Manufacturing order flow", () => {
  test.describe.configure({ mode: "serial" });

  const ts = Date.now();
  const unitId = getUnitId();

  const sandName = `Manufacturing Sand ${ts}`;
  const compostName = `Manufacturing Compost ${ts}`;
  const productName = `Garden Blend ${ts}`;
  const customerName = `Manufacturing Customer ${ts}`;

  let sandId: string;
  let compostId: string;
  let productId: string;
  let customerId: string;
  let salesOrderId: string;
  let salesOrderLineId: string;
  let salesOrderNumber: string;

  let releasedOrderId: string;
  let completionOrderId: string;

  test("sets up BOM-backed fixtures and a sales line for traceability", async ({
    db,
  }) => {
    expect(unitId).toBeTruthy();

    const sandCreate = await createItem({
      name: sandName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `MAT-SAND-${ts}`,
      category: `Manufacturing ${ts}`,
      description: "Primary base material",
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "10",
      safetyStock: "0",
      bom: [],
    });

    expect(sandCreate.status).toBe(201);
    sandId = sandCreate.body.id;

    const sandUpdate = await updateItem(sandId, {
      name: sandName,
      sku: `MAT-SAND-${ts}`,
      category: `Manufacturing ${ts}`,
      description: "Primary base material",
      defaultPurchasePrice: "3.00",
      defaultSellingPrice: null,
      safetyStock: "0",
      stock: "20",
      bom: [],
    });

    expect(sandUpdate.status).toBe(200);

    const compostCreate = await createItem({
      name: compostName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `MAT-COMP-${ts}`,
      category: `Manufacturing ${ts}`,
      description: "Secondary ingredient",
      defaultPurchasePrice: "1.50",
      defaultSellingPrice: null,
      stock: "10",
      safetyStock: "0",
      bom: [],
    });

    expect(compostCreate.status).toBe(201);
    compostId = compostCreate.body.id;

    const productCreate = await createItem({
      name: productName,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `PROD-BLEND-${ts}`,
      category: `Manufacturing ${ts}`,
      description: "Finished manufactured product",
      defaultPurchasePrice: null,
      defaultSellingPrice: "45.00",
      stock: "0",
      safetyStock: "0",
      bom: [
        { componentId: sandId, quantity: "2" },
        { componentId: compostId, quantity: "1" },
      ],
    });

    expect(productCreate.status).toBe(201);
    productId = productCreate.body.id;

    customerId = await createCustomer(customerName);
    salesOrderId = await createSalesOrder({
      customerId,
      itemId: productId,
      quantity: "4",
      unitPrice: "45.00",
      requestedDate: "2026-04-20",
      notes: "Manufacturing link coverage",
    });

    const [salesOrder] = await db
      .select({
        id: salesOrders.id,
        orderNumber: salesOrders.orderNumber,
      })
      .from(salesOrders)
      .where(eq(salesOrders.id, salesOrderId));

    expect(salesOrder).toBeTruthy();
    salesOrderNumber = salesOrder.orderNumber;

    const [salesLine] = await db
      .select({
        id: salesOrderLines.id,
        itemId: salesOrderLines.itemId,
        quantity: salesOrderLines.quantity,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, salesOrderId));

    expect(salesLine).toBeTruthy();
    expect(salesLine.itemId).toBe(productId);
    expect(salesLine.quantity).toBe("4.0000");
    salesOrderLineId = salesLine.id;

    const sandLots = await db.select().from(lots).where(eq(lots.itemId, sandId));
    expect(sandLots).toHaveLength(2);

    const sandLotQuantities = sandLots
      .map((lot) => lot.quantity)
      .sort((a, b) => parseFloat(a) - parseFloat(b));
    expect(sandLotQuantities).toEqual(["10.0000", "10.0000"]);

    const compostLots = await db.select().from(lots).where(eq(lots.itemId, compostId));
    expect(compostLots).toHaveLength(1);
    expect(compostLots[0].quantity).toBe("10.0000");

    const [productRow] = await db
      .select({
        id: items.id,
        expectedQty: items.expectedQty,
        committedQty: items.committedQty,
      })
      .from(items)
      .where(eq(items.id, productId));

    expect(productRow).toBeTruthy();
    expect(productRow.expectedQty).toBe("0.0000");
    expect(productRow.committedQty).toBe("0.0000");
  });

  test("creates a draft manufacturing order with BOM snapshots and sales traceability", async ({
    page,
    db,
  }) => {
    await page.goto("/manufacturing/orders/new");
    await expect(page.getByText("Add Manufacturing Order")).toBeVisible();

    const productInput = page.getByPlaceholder("Search products...");
    await productInput.click();
    await productInput.fill(productName);
    await page.getByRole("option", { name: new RegExp(productName) }).click();

    await expect(page.locator("tbody tr")).toHaveCount(2);
    await expect(page.locator("table")).toContainText(sandName);
    await expect(page.locator("table")).toContainText(compostName);

    await page.getByLabel("Planned Quantity").fill("5");
    await page.getByLabel("Planned Date").fill("2026-04-25");

    const salesLineInput = page.getByPlaceholder("Search sales lines...");
    await salesLineInput.click();
    await salesLineInput.fill(salesOrderNumber);
    await page.getByRole("option", { name: new RegExp(salesOrderNumber) }).click();

    await page.getByLabel("Notes").fill("Initial draft manufacturing order");
    await page.getByRole("button", { name: "Create Order" }).click();

    await page.waitForURL(/\/manufacturing\/orders\/[0-9a-f-]+$/);
    releasedOrderId = page.url().split("/").at(-1) ?? "";
    expect(releasedOrderId).toBeTruthy();

    const [order] = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, releasedOrderId));

    expect(order).toBeTruthy();
    expect(order.status).toBe("draft");
    expect(order.orderNumber).toMatch(/^MO-\d{4}-\d{4}$/);
    expect(order.productId).toBe(productId);
    expect(order.salesOrderId).toBe(salesOrderId);
    expect(order.salesOrderLineId).toBe(salesOrderLineId);
    expect(order.salesOrderNumber).toBe(salesOrderNumber);
    expect(order.salesCustomerName).toBe(customerName);
    expect(order.plannedQuantity).toBe("5.0000");
    expect(order.plannedDate).toBe("2026-04-25");
    expect(order.notes).toBe("Initial draft manufacturing order");

    const ingredients = await db
      .select()
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, releasedOrderId));

    expect(ingredients).toHaveLength(2);

    const ingredientByItemId = new Map(ingredients.map((row) => [row.itemId, row]));
    expect(ingredientByItemId.get(sandId)?.itemName).toBe(sandName);
    expect(ingredientByItemId.get(sandId)?.quantityPerUnit).toBe("2.0000");
    expect(ingredientByItemId.get(sandId)?.plannedQuantity).toBe("10.0000");
    expect(ingredientByItemId.get(compostId)?.itemName).toBe(compostName);
    expect(ingredientByItemId.get(compostId)?.quantityPerUnit).toBe("1.0000");
    expect(ingredientByItemId.get(compostId)?.plannedQuantity).toBe("5.0000");
  });

  test("edits the draft order, recalculates ingredient totals, and releases with a shortage warning", async ({
    page,
    db,
  }) => {
    const staleSalesOrderLineId = salesOrderLineId;
    await updateSalesOrder({
      salesOrderId,
      customerId,
      itemId: productId,
      quantity: "4",
      unitPrice: "45.00",
      requestedDate: "2026-04-22",
      notes: "Sales order line rewritten before manufacturing edit",
    });

    const [rewrittenSalesLine] = await db
      .select({
        id: salesOrderLines.id,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, salesOrderId));

    expect(rewrittenSalesLine).toBeTruthy();
    expect(rewrittenSalesLine.id).not.toBe(staleSalesOrderLineId);
    salesOrderLineId = rewrittenSalesLine.id;

    await page.goto(`/manufacturing/orders/${releasedOrderId}/edit`);
    await expect(page.getByText("Edit Manufacturing Order")).toBeVisible();

    await page.getByLabel("Planned Quantity").fill("6");
    const sandRow = page
      .locator("tbody tr")
      .filter({ hasText: sandName });
    await sandRow.locator('input[inputmode="decimal"]').fill("3.5");
    await page.getByLabel("Notes").fill("Edited draft before release");

    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.waitForURL(new RegExp(`/manufacturing/orders/${releasedOrderId}$`));

    const [editedOrder] = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, releasedOrderId));

    expect(editedOrder.plannedQuantity).toBe("6.0000");
    expect(editedOrder.notes).toBe("Edited draft before release");
    expect(editedOrder.salesOrderId).toBe(salesOrderId);
    expect(editedOrder.salesOrderLineId).toBe(salesOrderLineId);

    const editedIngredients = await db
      .select()
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, releasedOrderId));
    const editedByItemId = new Map(editedIngredients.map((row) => [row.itemId, row]));

    expect(editedByItemId.get(sandId)?.quantityPerUnit).toBe("3.5000");
    expect(editedByItemId.get(sandId)?.plannedQuantity).toBe("21.0000");
    expect(editedByItemId.get(compostId)?.quantityPerUnit).toBe("1.0000");
    expect(editedByItemId.get(compostId)?.plannedQuantity).toBe("6.0000");

    await page.getByRole("button", { name: "Release" }).click();

    await expect(page.getByText("Release with shortages?")).toBeVisible({
      timeout: 15_000,
    });
    const shortageDialog = page.getByRole("alertdialog");
    await expect(shortageDialog.locator("table")).toContainText(sandName);
    await expect(shortageDialog.locator("table")).toContainText("21");
    await expect(shortageDialog.locator("table")).toContainText("20");
    await shortageDialog.getByText("Shortage", { exact: true }).hover();
    await expect(page.getByText("Needed minus available right now.")).toBeVisible();

    await page.getByRole("button", { name: "Release Anyway" }).click();

    await expect(
      page.getByRole("button", { name: "Complete" })
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);

    const [releasedOrder] = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, releasedOrderId));

    expect(releasedOrder.status).toBe("released");
    expect(releasedOrder.releasedAt).toBeTruthy();

    const [productRow] = await db
      .select({
        expectedQty: items.expectedQty,
      })
      .from(items)
      .where(eq(items.id, productId));

    expect(productRow.expectedQty).toBe("6.0000");
  });

  test("cancels a released order without mutating lots or stock movements", async ({
    page,
    db,
  }) => {
    await page.goto(`/manufacturing/orders/${releasedOrderId}`);
    await expect(page.getByRole("button", { name: "Complete" })).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Cancel this order?")).toBeVisible();
    await page.getByRole("button", { name: "Cancel Order" }).click();

    await expect(page.getByRole("button", { name: "Delete" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "Complete" })).toHaveCount(0);

    const [cancelledOrder] = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, releasedOrderId));

    expect(cancelledOrder.status).toBe("cancelled");
    expect(cancelledOrder.cancelledAt).toBeTruthy();

    const [productRow] = await db
      .select({
        expectedQty: items.expectedQty,
      })
      .from(items)
      .where(eq(items.id, productId));

    expect(productRow.expectedQty).toBe("0.0000");

    const referencedMovements = await db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.referenceId, releasedOrderId));

    expect(referencedMovements).toHaveLength(0);
  });

  test("completes a released order with FIFO consumption, actuals, and a produced lot", async ({
    page,
    db,
  }) => {
    await page.goto("/manufacturing/orders/new");
    await expect(page.getByText("Add Manufacturing Order")).toBeVisible();

    const productInput = page.getByPlaceholder("Search products...");
    await productInput.click();
    await productInput.fill(productName);
    await page.getByRole("option", { name: new RegExp(productName) }).click();

    await page.getByLabel("Planned Quantity").fill("4");
    await page.getByLabel("Notes").fill("Completion flow");
    await page.getByRole("button", { name: "Create Order" }).click();

    await page.waitForURL(/\/manufacturing\/orders\/[0-9a-f-]+$/);
    completionOrderId = page.url().split("/").at(-1) ?? "";
    expect(completionOrderId).toBeTruthy();

    await page.getByRole("button", { name: "Release" }).click();
    await expect(page.getByRole("button", { name: "Complete" })).toBeVisible({
      timeout: 15_000,
    });

    const [releasedProduct] = await db
      .select({
        expectedQty: items.expectedQty,
      })
      .from(items)
      .where(eq(items.id, productId));
    expect(releasedProduct.expectedQty).toBe("4.0000");

    await page.getByRole("button", { name: "Complete" }).click();
    await page.getByLabel("Actual Quantity").fill("12");
    await page.getByRole("button", { name: "Complete Order" }).click();

    await expect(
      page.getByText("Cannot complete order. Short on")
    ).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Complete" }).click();
    await page.getByLabel("Actual Quantity").fill("6");
    await page.getByRole("button", { name: "Complete Order" }).click();

    await expect
      .poll(
        async () => {
          const [order] = await db
            .select({ status: manufacturingOrders.status })
            .from(manufacturingOrders)
            .where(eq(manufacturingOrders.id, completionOrderId));
          return order?.status ?? null;
        },
        { timeout: 15_000 }
      )
      .toBe("completed");

    const [completedOrder] = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, completionOrderId));

    expect(completedOrder.status).toBe("completed");
    expect(completedOrder.actualQuantity).toBe("6.0000");
    expect(completedOrder.actualMaterialCost).toBe("29.0000");
    expect(completedOrder.actualCostPerUnit).toBe("4.8333");
    expect(completedOrder.completedAt).toBeTruthy();

    const completedIngredients = await db
      .select()
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, completionOrderId));
    const completedByItemId = new Map(
      completedIngredients.map((row) => [row.itemId, row])
    );

    expect(completedByItemId.get(sandId)?.actualQuantity).toBe("12.0000");
    expect(completedByItemId.get(sandId)?.actualCostTotal).toBe("20.0000");
    expect(completedByItemId.get(compostId)?.actualQuantity).toBe("6.0000");
    expect(completedByItemId.get(compostId)?.actualCostTotal).toBe("9.0000");

    const sandLots = await db.select().from(lots).where(eq(lots.itemId, sandId));
    expect(sandLots).toHaveLength(2);

    const sandLotSummary = sandLots
      .map((lot) => ({
        lotNumber: lot.lotNumber,
        quantity: lot.quantity,
        costPerUnit: lot.costPerUnit,
      }))
      .sort((a, b) => a.lotNumber.localeCompare(b.lotNumber));

    expect(sandLotSummary[0].quantity).toBe("0.0000");
    expect(sandLotSummary[0].costPerUnit).toBe("2.0000");
    expect(sandLotSummary[1].quantity).toBe("8.0000");
    expect(sandLotSummary[1].costPerUnit).toBeNull();

    const compostLots = await db.select().from(lots).where(eq(lots.itemId, compostId));
    expect(compostLots).toHaveLength(1);
    expect(compostLots[0].quantity).toBe("4.0000");

    const producedLots = await db.select().from(lots).where(eq(lots.itemId, productId));
    expect(producedLots).toHaveLength(1);
    expect(producedLots[0].quantity).toBe("6.0000");
    expect(producedLots[0].costPerUnit).toBe("4.8333");

    const movements = await db
      .select({
        itemId: stockMovements.itemId,
        lotId: stockMovements.lotId,
        quantity: stockMovements.quantity,
        movementType: stockMovements.movementType,
        referenceType: stockMovements.referenceType,
      })
      .from(stockMovements)
      .where(eq(stockMovements.referenceId, completionOrderId));

    expect(movements).toHaveLength(4);
    expect(
      movements.filter((movement) => movement.movementType === "manufacturing_consumed")
    ).toHaveLength(3);
    expect(
      movements.filter((movement) => movement.movementType === "manufacturing_produced")
    ).toHaveLength(1);
    expect(
      movements.every((movement) => movement.referenceType === "manufacturing_order")
    ).toBe(true);

    const [completedProduct] = await db
      .select({
        expectedQty: items.expectedQty,
      })
      .from(items)
      .where(eq(items.id, productId));
    expect(completedProduct.expectedQty).toBe("0.0000");
  });

  test("completes decimal ingredient quantities without a false shortage", async ({
    db,
  }) => {
    const decimalMaterialName = `Decimal Resin ${ts}`;
    const decimalProductName = `Decimal Blend ${ts}`;

    const decimalMaterialCreate = await createItem({
      name: decimalMaterialName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `MAT-DEC-${ts}`,
      category: `Manufacturing ${ts}`,
      description: "Decimal ingredient",
      defaultPurchasePrice: "4.00",
      defaultSellingPrice: null,
      stock: "0.3",
      safetyStock: "0",
      bom: [],
    });

    expect(decimalMaterialCreate.status).toBe(201);
    const decimalMaterialId = decimalMaterialCreate.body.id as string;

    const decimalProductCreate = await createItem({
      name: decimalProductName,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `PROD-DEC-${ts}`,
      category: `Manufacturing ${ts}`,
      description: "Decimal finished product",
      defaultPurchasePrice: null,
      defaultSellingPrice: "12.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: decimalMaterialId, quantity: "0.1" }],
    });

    expect(decimalProductCreate.status).toBe(201);
    const decimalProductId = decimalProductCreate.body.id as string;

    const decimalOrderId = await createManufacturingOrder({
      productId: decimalProductId,
      plannedQuantity: "3",
      notes: "Decimal completion coverage",
      ingredients: [{ itemId: decimalMaterialId, quantityPerUnit: "0.1" }],
    });

    await releaseManufacturingOrder(decimalOrderId);

    const completeResult = await completeManufacturingOrder(decimalOrderId, "3");
    expect(completeResult.status).toBe(200);
    expect(completeResult.body?.id).toBe(decimalOrderId);

    const [completedOrder] = await db
      .select({
        status: manufacturingOrders.status,
        actualQuantity: manufacturingOrders.actualQuantity,
      })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, decimalOrderId));

    expect(completedOrder.status).toBe("completed");
    expect(completedOrder.actualQuantity).toBe("3.0000");

    const [completedIngredient] = await db
      .select({
        actualQuantity: manufacturingOrderIngredients.actualQuantity,
      })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, decimalOrderId));

    expect(completedIngredient.actualQuantity).toBe("0.3000");

    const decimalLots = await db
      .select({
        quantity: lots.quantity,
      })
      .from(lots)
      .where(eq(lots.itemId, decimalMaterialId));

    expect(decimalLots).toHaveLength(1);
    expect(decimalLots[0].quantity).toBe("0.0000");
  });

  test("blocks deleting items that are used by an active manufacturing order", async ({
    db,
  }) => {
    const guardOrderId = await createManufacturingOrder({
      productId,
      plannedQuantity: "1",
      notes: "Delete guard coverage",
      ingredients: [
        { itemId: sandId, quantityPerUnit: "2" },
        { itemId: compostId, quantityPerUnit: "1" },
      ],
    });

    const [guardOrder] = await db
      .select({
        status: manufacturingOrders.status,
      })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, guardOrderId));

    expect(guardOrder.status).toBe("draft");

    const clearBomResult = await updateItem(productId, {
      name: productName,
      sku: `PROD-BLEND-${ts}`,
      category: `Manufacturing ${ts}`,
      description: "Finished manufactured product",
      defaultPurchasePrice: null,
      defaultSellingPrice: "45.00",
      safetyStock: "0",
      bom: [],
    });
    expect(clearBomResult.status).toBe(200);

    const deleteSalesOrderResponse = await testFetch("/api/sales-orders", {
      method: "DELETE",
      body: JSON.stringify({ ids: [salesOrderId] }),
    });
    expect(deleteSalesOrderResponse.status).toBe(200);

    const deleteIngredientResult = await deleteItem(sandId);
    expect(deleteIngredientResult.status).toBe(400);
    expect(deleteIngredientResult.body?.error).toContain(
      "draft or released manufacturing orders"
    );

    const deleteProductResult = await deleteItem(productId);
    expect(deleteProductResult.status).toBe(400);
    expect(deleteProductResult.body?.error).toContain(
      "draft or released manufacturing orders"
    );
  });
});
