import { eq } from "drizzle-orm";
import { format } from "date-fns";
import { test, expect, filterList, getIdFromUrl, selectDate } from "../fixtures";
import {
  inventoryEvents,
  inventoryItemBalances,
  inventoryLotBalances,
  lots,
  manufacturingOrderIngredients,
  manufacturingPickAllocations,
  manufacturingOrders,
  salesOrderLines,
  salesOrders,
} from "../../../lib/db/schema";
import {
  createItem,
  createUnit,
  deleteItem,
  getUnitId,
  testFetch,
  updateItem,
} from "../../helpers/api";

async function createCustomer(name: string) {
  const response = await testFetch("/api/customers", {
    method: "POST",
    body: JSON.stringify({
      name,
      email: null,
      phone: null,
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
  lines: Array<{
    itemId: string;
    quantity: string;
    unitPrice: string;
  }>;
  requestedDate?: string | null;
  notes?: string | null;
}) {
  const response = await testFetch("/api/sales-orders", {
    method: "POST",
    body: JSON.stringify({
      customerId: payload.customerId,
      status: "draft",
      shipDate: payload.requestedDate ?? "2026-04-20",
      requestedDate: payload.requestedDate ?? null,
      notes: payload.notes ?? null,
      lines: payload.lines,
      confirmOversell: false,
    }),
  });
  const body = await response.json().catch(() => null);

  expect(response.status).toBe(201);
  expect(body?.id).toBeTruthy();

  return body.id as string;
}

async function confirmSalesOrder(orderId: string, confirmOversell = false) {
  const response = await testFetch(`/api/sales-orders/${orderId}/confirm`, {
    method: "POST",
    body: JSON.stringify({ confirmOversell }),
  });
  const body = await response.json().catch(() => null);

  expect(response.status).toBe(200);
  expect(body?.id).toBe(orderId);
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
  plannedDate?: string | null;
  notes?: string | null;
  salesOrderId?: string | null;
  salesOrderLineId?: string | null;
  ingredients: Array<{ itemId: string; quantityPerUnit: string }>;
}) {
  const response = await testFetch("/api/manufacturing-orders", {
    method: "POST",
    body: JSON.stringify({
      productId: payload.productId,
      salesOrderId: payload.salesOrderId ?? null,
      salesOrderLineId: payload.salesOrderLineId ?? null,
      plannedQuantity: payload.plannedQuantity,
      plannedDate: payload.plannedDate ?? null,
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

async function createLinkedManufacturingOrderExpectingFailure(payload: {
  productId: string;
  plannedQuantity: string;
  plannedDate?: string | null;
  notes?: string | null;
  salesOrderId: string;
  salesOrderLineId: string;
  ingredients: Array<{ itemId: string; quantityPerUnit: string }>;
}) {
  const response = await testFetch("/api/manufacturing-orders", {
    method: "POST",
    body: JSON.stringify({
      productId: payload.productId,
      salesOrderId: payload.salesOrderId,
      salesOrderLineId: payload.salesOrderLineId,
      plannedQuantity: payload.plannedQuantity,
      plannedDate: payload.plannedDate ?? null,
      notes: payload.notes ?? null,
      ingredients: payload.ingredients,
      confirmShortage: false,
    }),
  });
  const body = await response.json().catch(() => null);

  expect(response.status).toBe(400);
  expect(body?.error).toContain("Create sales-linked manufacturing orders");
}

async function createManufacturingOrdersFromSalesOrder(payload: {
  salesOrderId: string;
  plannedDate?: string | null;
  salesOrderLineIds?: string[];
  notes?: string | null;
}) {
  let salesOrderLineIds = payload.salesOrderLineIds;

  if (!salesOrderLineIds) {
    const previewResponse = await testFetch(
      `/api/sales-orders/${payload.salesOrderId}/manufacturing-orders`
    );
    const preview = (await previewResponse.json()) as {
      lines?: Array<{ salesOrderLineId: string; status: string }>;
    };
    salesOrderLineIds =
      preview.lines
        ?.filter((line) => line.status === "will_create")
        .map((line) => line.salesOrderLineId) ?? [];
  }

  const response = await testFetch(
    `/api/sales-orders/${payload.salesOrderId}/manufacturing-orders`,
    {
      method: "POST",
      body: JSON.stringify({
        plannedDate: payload.plannedDate ?? null,
        salesOrderLineIds,
        notes: payload.notes ?? null,
      }),
    }
  );
  const body = (await response.json().catch(() => null)) as
    | {
        created?: Array<{
          salesOrderLineId: string;
          manufacturingOrderId: string;
          orderNumber: string;
        }>;
        skipped?: Array<{
          salesOrderLineId: string;
          reason: string;
        }>;
      }
    | null;

  expect(response.status).toBe(201);

  return body;
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

async function pickAllManufacturingIngredients(orderId: string) {
  const executionResponse = await testFetch(`/api/manufacturing-orders/${orderId}/execution`);
  const executionBody = await executionResponse.json().catch(() => null);

  expect(executionResponse.status).toBe(200);

  for (const ingredient of executionBody?.ingredients ?? []) {
    const pickResponse = await testFetch(
      `/api/manufacturing-orders/${orderId}/ingredients/${ingredient.id}/pick`,
      {
        method: "POST",
        body: JSON.stringify({}),
      }
    );
    const pickBody = await pickResponse.json().catch(() => null);

    expect(pickResponse.status).toBe(200);
    expect(pickBody?.id).toBe(ingredient.id);
  }
}

test.describe("Manufacturing order flow", () => {
  test.describe.configure({ mode: "serial" });

  const ts = Date.now();
  const unitId = getUnitId();
  const nextMonthFirst = new Date();
  nextMonthFirst.setMonth(nextMonthFirst.getMonth() + 1, 1);
  const expectedBatchPlannedDate = format(nextMonthFirst, "yyyy-MM-dd");
  const expectedBatchPlannedDateLabel = new Date(
    `${expectedBatchPlannedDate}T00:00:00`
  ).toLocaleDateString("en-US");

  const sandName = `Manufacturing Sand ${ts}`;
  const compostName = `Manufacturing Compost ${ts}`;
  const productName = `Garden Blend ${ts}`;
  const nonManufacturableProductName = `Display Mix ${ts}`;
  const customerName = `Manufacturing Customer ${ts}`;

  let sandId: string;
  let compostId: string;
  let productId: string;
  let nonManufacturableProductId: string;
  let customerId: string;
  let salesOrderId: string;
  let salesOrderLineId: string;
  let salesOrderNumber: string;
  let batchSalesOrderId: string;

  let releasedOrderId: string;
  let completionOrderId: string;

  test("sets up BOM-backed fixtures and a sales line for traceability", async ({
    db,
  }) => {
    test.slow();

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
      manufacturingMode: "discrete",
      expectedBatchYield: null,
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

    const nonManufacturableProductCreate = await createItem({
      name: nonManufacturableProductName,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `PROD-DISPLAY-${ts}`,
      category: `Manufacturing ${ts}`,
      description: "Confirmed sales order line without a BOM",
      defaultPurchasePrice: null,
      defaultSellingPrice: "18.00",
      stock: "0",
      safetyStock: "0",
      bom: [],
    });

    expect(nonManufacturableProductCreate.status).toBe(201);
    nonManufacturableProductId = nonManufacturableProductCreate.body.id;

    customerId = await createCustomer(customerName);
    salesOrderId = await createSalesOrder({
      customerId,
      lines: [
        {
          itemId: productId,
          quantity: "4",
          unitPrice: "45.00",
        },
      ],
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
        expectedQty: inventoryItemBalances.expectedQty,
        committedQty: inventoryItemBalances.committedQty,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, productId));

    expect(productRow?.expectedQty ?? "0.0000").toBe("0.0000");
    expect(productRow?.committedQty ?? "0.0000").toBe("0.0000");
  });

  test("blocks direct sales-linked creation through the manual manufacturing API", async () => {
    await createLinkedManufacturingOrderExpectingFailure({
      productId,
      salesOrderId,
      salesOrderLineId,
      plannedQuantity: "5",
      plannedDate: "2026-04-25",
      notes: "Legacy direct linked create should fail",
      ingredients: [
        { itemId: sandId, quantityPerUnit: "2" },
        { itemId: compostId, quantityPerUnit: "1" },
      ],
    });
  });

  test("creates a draft manufacturing order, then links it from edit with BOM snapshots intact", async ({
    page,
    db,
  }) => {
    releasedOrderId = await createManufacturingOrder({
      productId,
      plannedQuantity: "5",
      plannedDate: "2026-04-25",
      notes: "Initial draft manufacturing order",
      ingredients: [
        { itemId: sandId, quantityPerUnit: "2" },
        { itemId: compostId, quantityPerUnit: "1" },
      ],
    });

    await page.goto(`/manufacturing/orders/${releasedOrderId}`);
    await expect(page.getByText("Initial draft manufacturing order")).toBeVisible();
    await expect(page.locator("main").getByText("Draft", { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText(
        new Date("2026-04-25T00:00:00").toLocaleDateString("en-US"),
        { exact: true }
      )
    ).toBeVisible();
    await expect(page.locator("table").first()).toContainText(sandName);
    await expect(page.locator("table").first()).toContainText(compostName);
    await expect(page.locator("table").first()).toContainText("10");
    await expect(page.locator("table").first()).toContainText("5");

    const [order] = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, releasedOrderId));

    expect(order).toBeTruthy();
    expect(order.status).toBe("draft");
    expect(order.orderNumber).toMatch(/^MO-\d{4}-\d{4}$/);
    expect(order.productId).toBe(productId);
    expect(order.salesOrderId).toBeNull();
    expect(order.salesOrderLineId).toBeNull();
    expect(order.salesOrderNumber).toBeNull();
    expect(order.salesCustomerName).toBeNull();
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

    await page.goto(`/manufacturing/orders/${releasedOrderId}/edit`);
    await expect(page.getByText("Edit Manufacturing Order")).toBeVisible();

    const salesLineInput = page.getByLabel("Sales Order Line");
    await salesLineInput.click();
    await salesLineInput.fill(salesOrderNumber);
    await page
      .getByRole("option", {
        name: new RegExp(`${salesOrderNumber}.*${customerName}`, "i"),
      })
      .click();

    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.waitForURL(new RegExp(`/manufacturing/orders/${releasedOrderId}$`));

    const [linkedOrder] = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, releasedOrderId));

    expect(linkedOrder.salesOrderId).toBe(salesOrderId);
    expect(linkedOrder.salesOrderLineId).toBe(salesOrderLineId);
    expect(linkedOrder.salesOrderNumber).toBe(salesOrderNumber);
    expect(linkedOrder.salesCustomerName).toBe(customerName);

    await expect(page.getByText(`${salesOrderNumber} - ${customerName}`)).toBeVisible();
    await page.goto("/manufacturing/orders");
    await filterList(page, "Search manufacturing orders", linkedOrder.orderNumber);
    const draftRow = page.getByRole("row", { name: new RegExp(linkedOrder.orderNumber) });
    await expect(draftRow).toContainText(productName);
    await expect(draftRow).toContainText(salesOrderNumber);
    await expect(draftRow).toContainText("Draft");
  });

  test("creates manufacturing orders from a confirmed sales order and skips non-manufacturable lines", async ({
    page,
    db,
  }) => {
    batchSalesOrderId = await createSalesOrder({
      customerId,
      lines: [
        {
          itemId: productId,
          quantity: "2",
          unitPrice: "45.00",
        },
        {
          itemId: nonManufacturableProductId,
          quantity: "3",
          unitPrice: "18.00",
        },
      ],
      requestedDate: "2026-04-30",
      notes: "Batch manufacturing coverage",
    });

    const [batchOrder] = await db
      .select({
        orderNumber: salesOrders.orderNumber,
      })
      .from(salesOrders)
      .where(eq(salesOrders.id, batchSalesOrderId));

    expect(batchOrder).toBeTruthy();
    await confirmSalesOrder(batchSalesOrderId, true);

    await page.goto(`/sales/orders/${batchSalesOrderId}`);
    await page.getByRole("button", { name: "Create MOs", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Create Manufacturing Orders" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(batchOrder.orderNumber)).toBeVisible();
    await expect(dialog.locator("table")).toContainText(productName);
    await expect(dialog.locator("table")).toContainText(nonManufacturableProductName);
    await expect(dialog.locator("table")).toContainText("Will create");
    await expect(dialog.locator("table")).toContainText("Skipped");
    await expect(dialog.locator("table")).toContainText(
      "Product has no active BOM ingredients."
    );

    await selectDate(page, dialog.getByLabel("Planned Date"), expectedBatchPlannedDate);
    const createResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(
          `/api/sales-orders/${batchSalesOrderId}/manufacturing-orders`
        ) && response.request().method() === "POST"
    );
    await page.getByRole("button", { name: "Create 1 order" }).click();
    expect((await createResponse).status()).toBe(201);

    await expect(page.getByText("Linked Manufacturing Orders")).toBeVisible();

    const lineRows = await db
      .select({
        id: salesOrderLines.id,
        itemId: salesOrderLines.itemId,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, batchSalesOrderId));
    const lineByItemId = new Map(lineRows.map((line) => [line.itemId, line.id]));

    const createdOrders = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.salesOrderId, batchSalesOrderId));

    expect(createdOrders).toHaveLength(1);

    const batchManufacturingOrder = createdOrders[0];
    expect(batchManufacturingOrder.productId).toBe(productId);
    expect(batchManufacturingOrder.salesOrderLineId).toBe(lineByItemId.get(productId));
    expect(batchManufacturingOrder.plannedQuantity).toBe("2.0000");
    expect(batchManufacturingOrder.plannedDate).toBe(expectedBatchPlannedDate);
    expect(batchManufacturingOrder.notes).toBeNull();

    const batchIngredients = await db
      .select()
      .from(manufacturingOrderIngredients)
      .where(
        eq(
          manufacturingOrderIngredients.manufacturingOrderId,
          batchManufacturingOrder.id
        )
      );

    expect(batchIngredients).toHaveLength(2);
    await expect(
      page.getByRole("link", { name: batchManufacturingOrder.orderNumber })
    ).toBeVisible();
    await expect(page.locator("table").last()).toContainText("Draft");
    await expect(page.locator("table").last()).toContainText(productName);
    await expect(page.locator("table").last()).toContainText("2");

    await page.goto("/manufacturing/orders");
    await filterList(page, "Search manufacturing orders", batchManufacturingOrder.orderNumber);
    const createdRow = page.getByRole("row", {
      name: new RegExp(batchManufacturingOrder.orderNumber),
    });
    await expect(createdRow).toContainText(productName);
    await expect(createdRow).toContainText(batchOrder.orderNumber);
    await expect(createdRow).toContainText("Draft");
    await expect(createdRow).toContainText(expectedBatchPlannedDateLabel);
  });

  test("completed linked manufacturing orders keep Create MOs blocked for that sales line", async ({
    page,
    db,
  }) => {
    const repeatMaterialName = `Repeat-block Resin ${ts}`;
    const repeatProductName = `Repeat-block Blend ${ts}`;

    const repeatMaterialCreate = await createItem({
      name: repeatMaterialName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `MAT-REPEAT-${ts}`,
      category: `Manufacturing ${ts}`,
      description: "Repeat linked-order guard ingredient",
      defaultPurchasePrice: "4.00",
      defaultSellingPrice: null,
      stock: "5",
      safetyStock: "0",
      bom: [],
    });

    expect(repeatMaterialCreate.status).toBe(201);
    const repeatMaterialId = repeatMaterialCreate.body.id as string;

    const repeatProductCreate = await createItem({
      name: repeatProductName,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `PROD-REPEAT-${ts}`,
      category: `Manufacturing ${ts}`,
      description: "Repeat linked-order guard product",
      defaultPurchasePrice: null,
      defaultSellingPrice: "14.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: repeatMaterialId, quantity: "1" }],
    });

    expect(repeatProductCreate.status).toBe(201);
    const repeatProductId = repeatProductCreate.body.id as string;

    const repeatSalesOrderId = await createSalesOrder({
      customerId,
      lines: [
        {
          itemId: repeatProductId,
          quantity: "2",
          unitPrice: "14.00",
        },
      ],
      requestedDate: "2026-05-02",
      notes: "Completed linked order should still block repeat create",
    });

    await confirmSalesOrder(repeatSalesOrderId, true);

    const batchCreateBody = await createManufacturingOrdersFromSalesOrder({
      salesOrderId: repeatSalesOrderId,
      plannedDate: "2026-05-03",
      notes: "Repeat linked-order guard coverage",
    });

    expect(batchCreateBody?.created).toHaveLength(1);
    const repeatOrderId = batchCreateBody?.created?.[0]?.manufacturingOrderId;
    expect(repeatOrderId).toBeTruthy();

    await releaseManufacturingOrder(repeatOrderId!);
    await pickAllManufacturingIngredients(repeatOrderId!);

    const completeResult = await completeManufacturingOrder(repeatOrderId!, "2");
    expect(completeResult.status).toBe(200);
    expect(completeResult.body?.id).toBe(repeatOrderId);

    await page.goto(`/sales/orders/${repeatSalesOrderId}`);
    await expect(page.getByText("Ready to ship.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create MOs", exact: true })
    ).toHaveCount(0);

    const [repeatLine] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, repeatSalesOrderId))
      .limit(1);

    const retryResponse = await testFetch(
      `/api/sales-orders/${repeatSalesOrderId}/manufacturing-orders`,
      {
        method: "POST",
        body: JSON.stringify({
          plannedDate: "2026-05-04",
          salesOrderLineIds: [repeatLine.id],
          notes: "Second linked order should be blocked",
        }),
      }
    );
    const retryBody = await retryResponse.json().catch(() => null);

    expect(retryResponse.status).toBe(400);
    expect(retryBody?.error).toBe(
      "All manufacturable lines already have linked manufacturing orders."
    );

    const repeatOrders = await db
      .select({
        id: manufacturingOrders.id,
      })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.salesOrderId, repeatSalesOrderId));

    expect(repeatOrders).toHaveLength(1);
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
    await expect(page.getByText("Needed minus available.")).toBeVisible();

    await page.getByRole("button", { name: "Release Anyway" }).click();

    await expect(
      page.getByRole("link", { name: "Execute" })
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(page.locator("main").getByText("Released", { exact: true }).first()).toBeVisible();
    await expect(page.locator("table").first()).toContainText("21");
    await expect(page.locator("table").first()).toContainText("6");

    const [releasedOrder] = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, releasedOrderId));

    expect(releasedOrder.status).toBe("released");
    expect(releasedOrder.releasedAt).toBeTruthy();

    const [productRow] = await db
      .select({
        expectedQty: inventoryItemBalances.expectedQty,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, productId));

    expect(productRow.expectedQty).toBe("6.0000");

    await page.goto("/manufacturing/orders");
    await filterList(page, "Search manufacturing orders", releasedOrder.orderNumber);
    const releasedRow = page.getByRole("row", { name: new RegExp(releasedOrder.orderNumber) });
    await expect(releasedRow).toContainText("Released");
  });

  test("cancels a released order without mutating lots or stock movements", async ({
    page,
    db,
  }) => {
    await page.goto(`/manufacturing/orders/${releasedOrderId}`);
    await expect(page.getByRole("link", { name: "Execute" })).toBeVisible();

    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Cancel order" }).click();
    await expect(page.getByText("Cancel this order?")).toBeVisible();
    await page.getByRole("button", { name: "Cancel Order" }).click();

    await expect(page.locator("main").getByText("Cancelled", { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible({
      timeout: 15_000,
    });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("link", { name: "Execute" })).toHaveCount(0);
    await expect(page.locator("main").getByText("Cancelled", { exact: true }).first()).toBeVisible();

    const [cancelledOrder] = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, releasedOrderId));

    expect(cancelledOrder.status).toBe("cancelled");
    expect(cancelledOrder.cancelledAt).toBeTruthy();

    const [productRow] = await db
      .select({
        expectedQty: inventoryItemBalances.expectedQty,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, productId));

    expect(productRow.expectedQty).toBe("0.0000");

    const referencedMovements = await db
      .select()
      .from(inventoryEvents)
      .where(eq(inventoryEvents.referenceId, releasedOrderId));

    expect(
      referencedMovements.filter((event) =>
        [
          "manufacturing_ingredient_consumption",
          "manufacturing_output",
          "unpick_restock",
        ].includes(event.eventType)
      )
    ).toHaveLength(0);

    await page.goto("/manufacturing/orders");
    await filterList(page, "Search manufacturing orders", cancelledOrder.orderNumber);
    const cancelledRow = page.getByRole("row", {
      name: new RegExp(cancelledOrder.orderNumber),
    });
    await expect(cancelledRow).toContainText("Cancelled");
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
    completionOrderId = getIdFromUrl(page.url());
    expect(completionOrderId).toBeTruthy();

    await page.getByRole("button", { name: "Release" }).click();
    await expect(page.getByRole("link", { name: "Execute" })).toBeVisible({
      timeout: 15_000,
    });

    const [releasedProduct] = await db
      .select({
        expectedQty: inventoryItemBalances.expectedQty,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, productId));
    expect(releasedProduct.expectedQty).toBe("4.0000");

    await page.getByRole("link", { name: "Execute" }).click();
    await page.waitForURL(`**/manufacturing/orders/${completionOrderId}/execute`);

    const sandCard = page.locator('[data-slot="card"]').filter({ hasText: sandName }).first();
    const compostCard = page
      .locator('[data-slot="card"]')
      .filter({ hasText: compostName })
      .first();

    await sandCard.getByRole("button", { name: "Mark Done", exact: true }).click();
    await compostCard.getByRole("button", { name: "Mark Done", exact: true }).click();

    await page.getByRole("button", { name: "Complete Order" }).click();
    await page.getByLabel("Actual Output").fill("6");
    await page.getByRole("button", { name: "Confirm" }).click();

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

    await page.goto(`/manufacturing/orders/${completionOrderId}`);
    await expect(page.locator("main").getByText("Completed", { exact: true }).first()).toBeVisible();
    await expect(page.locator("dl").getByText("$22.00", { exact: true })).toBeVisible();
    await expect(page.locator("dl").getByText("$3.67", { exact: true })).toBeVisible();
    await expect(page.locator("table").first()).toContainText("8");
    await expect(page.locator("table").first()).toContainText("4");
    await expect(page.locator("table").nth(1)).toContainText("6");

    const [completedOrder] = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, completionOrderId));

    expect(completedOrder.status).toBe("completed");
    expect(completedOrder.actualQuantity).toBe("6.0000");
    expect(completedOrder.actualMaterialCost).toBe("22.0000");
    expect(completedOrder.actualCostPerUnit).toBe("3.6667");
    expect(completedOrder.completedAt).toBeTruthy();

    const completedIngredients = await db
      .select()
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, completionOrderId));
    const completedByItemId = new Map(
      completedIngredients.map((row) => [row.itemId, row])
    );

    expect(completedByItemId.get(sandId)?.pickedQuantity).toBe("8.0000");
    expect(completedByItemId.get(sandId)?.actualQuantity).toBe("8.0000");
    expect(completedByItemId.get(sandId)?.actualCostTotal).toBe("16.0000");
    expect(completedByItemId.get(compostId)?.pickedQuantity).toBe("4.0000");
    expect(completedByItemId.get(compostId)?.actualQuantity).toBe("4.0000");
    expect(completedByItemId.get(compostId)?.actualCostTotal).toBe("6.0000");

    const sandLots = await db
      .select({
        lotNumber: lots.lotNumber,
        quantity: lots.quantity,
        costPerUnit: inventoryLotBalances.unitCost,
      })
      .from(lots)
      .innerJoin(inventoryLotBalances, eq(inventoryLotBalances.lotId, lots.id))
      .where(eq(lots.itemId, sandId));
    expect(sandLots).toHaveLength(2);

    const sandLotSummary = sandLots
      .map((lot) => ({
        lotNumber: lot.lotNumber,
        quantity: lot.quantity,
        costPerUnit: lot.costPerUnit,
      }))
      .sort((a, b) => a.lotNumber.localeCompare(b.lotNumber));

    expect(sandLotSummary[0].quantity).toBe("2.0000");
    expect(sandLotSummary[0].costPerUnit).toBe("2.000000");
    expect(sandLotSummary[1].quantity).toBe("10.0000");
    expect(sandLotSummary[1].costPerUnit).toBe("2.000000");

    const compostLots = await db.select().from(lots).where(eq(lots.itemId, compostId));
    expect(compostLots).toHaveLength(1);
    expect(compostLots[0].quantity).toBe("6.0000");

    const producedLots = await db
      .select({
        quantity: lots.quantity,
        costPerUnit: inventoryLotBalances.unitCost,
      })
      .from(lots)
      .innerJoin(inventoryLotBalances, eq(inventoryLotBalances.lotId, lots.id))
      .where(eq(lots.itemId, productId));
    expect(producedLots).toHaveLength(1);
    expect(producedLots[0].quantity).toBe("6.0000");
    expect(producedLots[0].costPerUnit).toBe("3.666667");

    const movements = await db
      .select({
        itemId: inventoryEvents.itemId,
        lotId: inventoryEvents.lotId,
        quantity: inventoryEvents.quantity,
        eventType: inventoryEvents.eventType,
        referenceType: inventoryEvents.referenceType,
      })
      .from(inventoryEvents)
      .where(eq(inventoryEvents.referenceId, completionOrderId));

    expect(movements).toHaveLength(5);
    expect(
      movements.filter(
        (movement) => movement.eventType === "manufacturing_ingredient_consumption"
      )
    ).toHaveLength(2);
    expect(
      movements.filter((movement) => movement.eventType === "manufacturing_output")
    ).toHaveLength(1);
    expect(
      movements.filter((movement) => movement.eventType === "expected_increase")
    ).toHaveLength(1);
    expect(
      movements.filter((movement) => movement.eventType === "expected_release")
    ).toHaveLength(1);
    expect(
      movements.every((movement) => movement.referenceType === "manufacturing_order")
    ).toBe(true);

    const [completedProduct] = await db
      .select({
        expectedQty: inventoryItemBalances.expectedQty,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, productId));
    expect(completedProduct.expectedQty).toBe("0.0000");

    await page.goto("/manufacturing/orders");
    await filterList(page, "Search manufacturing orders", completedOrder.orderNumber);
    const completedRow = page.getByRole("row", {
      name: new RegExp(completedOrder.orderNumber),
    });
    await expect(completedRow).toContainText("Completed");
  });

  test("completes a finished good that consumes a manufactured subassembly", async ({
    db,
  }) => {
    const chainTs = Date.now();
    const category = `Subassembly ${chainTs}`;
    const additiveName = `Subassembly Additive ${chainTs}`;
    const carrierName = `Subassembly Carrier ${chainTs}`;
    const subassemblyName = `Intermediate Mix ${chainTs}`;
    const finishedName = `Nested Blend ${chainTs}`;

    const additiveCreate = await createItem({
      name: additiveName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `MAT-SUB-ADD-${chainTs}`,
      category,
      description: "Subassembly ingredient",
      defaultPurchasePrice: "5.00",
      defaultSellingPrice: null,
      stock: "6",
      safetyStock: "0",
      bom: [],
    });
    expect(additiveCreate.status).toBe(201);
    const additiveId = additiveCreate.body.id as string;

    const carrierCreate = await createItem({
      name: carrierName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `MAT-SUB-CAR-${chainTs}`,
      category,
      description: "Finished-good carrier",
      defaultPurchasePrice: "3.00",
      defaultSellingPrice: null,
      stock: "4",
      safetyStock: "0",
      bom: [],
    });
    expect(carrierCreate.status).toBe(201);
    const carrierId = carrierCreate.body.id as string;

    const subassemblyCreate = await createItem({
      name: subassemblyName,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `PROD-SUB-${chainTs}`,
      category,
      description: "Intermediate manufactured subassembly",
      defaultPurchasePrice: null,
      defaultSellingPrice: "25.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: additiveId, quantity: "2" }],
    });
    expect(subassemblyCreate.status).toBe(201);
    const subassemblyId = subassemblyCreate.body.id as string;

    const finishedCreate = await createItem({
      name: finishedName,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `PROD-NESTED-${chainTs}`,
      category,
      description: "Finished good that consumes a subassembly",
      defaultPurchasePrice: null,
      defaultSellingPrice: "45.00",
      stock: "0",
      safetyStock: "0",
      bom: [
        { componentId: carrierId, quantity: "1.5" },
        { componentId: subassemblyId, quantity: "1" },
      ],
    });
    expect(finishedCreate.status).toBe(201);
    const finishedId = finishedCreate.body.id as string;

    const subassemblyOrderId = await createManufacturingOrder({
      productId: subassemblyId,
      plannedQuantity: "2",
      notes: "Subassembly chain seed",
      ingredients: [{ itemId: additiveId, quantityPerUnit: "2" }],
    });

    await releaseManufacturingOrder(subassemblyOrderId);
    await pickAllManufacturingIngredients(subassemblyOrderId);
    const subassemblyCompleteResult = await completeManufacturingOrder(
      subassemblyOrderId,
      "2"
    );
    expect(subassemblyCompleteResult.status).toBe(200);

    const [subassemblyOrder] = await db
      .select({
        status: manufacturingOrders.status,
        actualQuantity: manufacturingOrders.actualQuantity,
      })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, subassemblyOrderId));
    expect(subassemblyOrder.status).toBe("completed");
    expect(subassemblyOrder.actualQuantity).toBe("2.0000");

    const subassemblyLotsBeforeFinished = await db
      .select({ quantity: lots.quantity })
      .from(lots)
      .where(eq(lots.itemId, subassemblyId));
    const subassemblyStockBeforeFinished = subassemblyLotsBeforeFinished.reduce(
      (sum, lot) => sum + parseFloat(lot.quantity),
      0
    );
    expect(subassemblyStockBeforeFinished).toBeCloseTo(2, 2);

    const finishedOrderId = await createManufacturingOrder({
      productId: finishedId,
      plannedQuantity: "1",
      notes: "Nested finished good coverage",
      ingredients: [
        { itemId: carrierId, quantityPerUnit: "1.5" },
        { itemId: subassemblyId, quantityPerUnit: "1" },
      ],
    });

    await releaseManufacturingOrder(finishedOrderId);
    await pickAllManufacturingIngredients(finishedOrderId);
    const finishedCompleteResult = await completeManufacturingOrder(
      finishedOrderId,
      "1"
    );
    expect(finishedCompleteResult.status).toBe(200);

    const [finishedOrder] = await db
      .select({
        status: manufacturingOrders.status,
        actualQuantity: manufacturingOrders.actualQuantity,
        actualCostPerUnit: manufacturingOrders.actualCostPerUnit,
      })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, finishedOrderId));
    expect(finishedOrder.status).toBe("completed");
    expect(finishedOrder.actualQuantity).toBe("1.0000");
    expect(finishedOrder.actualCostPerUnit).toBeTruthy();

    const finishedIngredients = await db
      .select({
        itemId: manufacturingOrderIngredients.itemId,
        actualQuantity: manufacturingOrderIngredients.actualQuantity,
      })
      .from(manufacturingOrderIngredients)
      .where(
        eq(manufacturingOrderIngredients.manufacturingOrderId, finishedOrderId)
      );
    const finishedIngredientByItemId = new Map(
      finishedIngredients.map((row) => [row.itemId, row])
    );

    expect(finishedIngredientByItemId.get(carrierId)?.actualQuantity).toBe(
      "1.5000"
    );
    expect(finishedIngredientByItemId.get(subassemblyId)?.actualQuantity).toBe(
      "1.0000"
    );

    const subassemblyLotsAfterFinished = await db
      .select({ quantity: lots.quantity })
      .from(lots)
      .where(eq(lots.itemId, subassemblyId));
    const subassemblyStockAfterFinished = subassemblyLotsAfterFinished.reduce(
      (sum, lot) => sum + parseFloat(lot.quantity),
      0
    );
    expect(subassemblyStockAfterFinished).toBeCloseTo(
      subassemblyStockBeforeFinished - 1,
      2
    );

    const finishedLots = await db
      .select({
        quantity: lots.quantity,
        costPerUnit: inventoryLotBalances.unitCost,
      })
      .from(lots)
      .innerJoin(inventoryLotBalances, eq(inventoryLotBalances.lotId, lots.id))
      .where(eq(lots.itemId, finishedId));
    expect(finishedLots).toHaveLength(1);
    expect(finishedLots[0].quantity).toBe("1.0000");
    expect(finishedLots[0].costPerUnit).toBeTruthy();

    const movements = await db
      .select({
        itemId: inventoryEvents.itemId,
        eventType: inventoryEvents.eventType,
        referenceType: inventoryEvents.referenceType,
      })
      .from(inventoryEvents)
      .where(eq(inventoryEvents.referenceId, finishedOrderId));

    expect(
      movements.some(
        (movement) =>
          movement.itemId === subassemblyId &&
          movement.eventType === "manufacturing_ingredient_consumption"
      )
    ).toBe(true);
    expect(
      movements.some(
        (movement) =>
          movement.itemId === finishedId &&
          movement.eventType === "manufacturing_output"
      )
    ).toBe(true);
    expect(
      movements.every(
        (movement) => movement.referenceType === "manufacturing_order"
      )
    ).toBe(true);
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
    await pickAllManufacturingIngredients(decimalOrderId);

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
    const guardMaterialName = `Delete Guard Resin ${ts}`;
    const guardProductName = `Delete Guard Blend ${ts}`;

    const guardMaterialCreate = await createItem({
      name: guardMaterialName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `MAT-DELETE-GUARD-${ts}`,
      category: `Manufacturing ${ts}`,
      description: "Ingredient protected by an active manufacturing order",
      defaultPurchasePrice: "4.00",
      defaultSellingPrice: null,
      stock: "5",
      safetyStock: "0",
      bom: [],
    });
    expect(guardMaterialCreate.status).toBe(201);
    const guardMaterialId = guardMaterialCreate.body.id as string;

    const guardProductCreate = await createItem({
      name: guardProductName,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `PROD-DELETE-GUARD-${ts}`,
      category: `Manufacturing ${ts}`,
      description: "Product protected by an active manufacturing order",
      defaultPurchasePrice: null,
      defaultSellingPrice: "18.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: guardMaterialId, quantity: "2" }],
    });
    expect(guardProductCreate.status).toBe(201);
    const guardProductId = guardProductCreate.body.id as string;

    const guardOrderId = await createManufacturingOrder({
      productId: guardProductId,
      plannedQuantity: "1",
      notes: "Delete guard coverage",
      ingredients: [
        { itemId: guardMaterialId, quantityPerUnit: "2" },
      ],
    });

    const [guardOrder] = await db
      .select({
        status: manufacturingOrders.status,
      })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, guardOrderId));

    expect(guardOrder.status).toBe("draft");

    const clearBomResult = await updateItem(guardProductId, {
      name: guardProductName,
      sku: `PROD-DELETE-GUARD-${ts}`,
      category: `Manufacturing ${ts}`,
      description: "Product protected by an active manufacturing order",
      defaultPurchasePrice: null,
      defaultSellingPrice: "18.00",
      manufacturingMode: "discrete",
      expectedBatchYield: null,
      safetyStock: "0",
      bom: [],
    });
    expect(clearBomResult.status).toBe(200);

    const deleteIngredientResult = await deleteItem(guardMaterialId);
    expect(deleteIngredientResult.status).toBe(400);
    expect(deleteIngredientResult.body?.error).toContain(
      "draft or released manufacturing orders"
    );

    const deleteProductResult = await deleteItem(guardProductId);
    expect(deleteProductResult.status).toBe(400);
    expect(deleteProductResult.body?.error).toContain(
      "draft or released manufacturing orders"
    );
  });

  test("preserves six-decimal converted ingredient cost through pick and completion", async ({
    db,
  }) => {
    const gallonUnit = await createUnit({
      name: `Manufacturing Gallon ${ts}`,
      size: "1",
      uom: "gal",
    });
    expect(gallonUnit.status).toBe(201);

    const purchaseUnit = await createUnit({
      name: `Manufacturing 325 Gallon Tote ${ts}`,
      size: "325",
      uom: "gal",
    });
    expect(purchaseUnit.status).toBe(201);

    const materialCreate = await createItem({
      name: `Manufacturing Converted Castings ${ts}`,
      itemType: "material",
      unitDefinitionId: gallonUnit.body.id,
      purchaseUnitDefinitionId: purchaseUnit.body.id,
      purchaseToStockFactor: "325",
      sku: `MFG-CONV-MAT-${ts}`,
      category: `Manufacturing ${ts}`,
      description: "Converted-cost ingredient",
      defaultPurchasePrice: "250",
      defaultSellingPrice: null,
      stock: "325",
      safetyStock: "0",
      bom: [],
    });
    expect(materialCreate.status).toBe(201);
    const convertedMaterialId = materialCreate.body.id as string;

    const productCreate = await createItem({
      name: `Manufacturing Converted Blend ${ts}`,
      itemType: "product",
      unitDefinitionId: gallonUnit.body.id,
      sku: `MFG-CONV-PROD-${ts}`,
      category: `Manufacturing ${ts}`,
      description: "Finished good costed from converted ingredient",
      defaultPurchasePrice: null,
      defaultSellingPrice: "15.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: convertedMaterialId, quantity: "10" }],
    });
    expect(productCreate.status).toBe(201);
    const convertedProductId = productCreate.body.id as string;

    const orderId = await createManufacturingOrder({
      productId: convertedProductId,
      plannedQuantity: "1",
      notes: "Precision cost carry-through",
      ingredients: [{ itemId: convertedMaterialId, quantityPerUnit: "10" }],
    });

    await releaseManufacturingOrder(orderId);
    await pickAllManufacturingIngredients(orderId);

    const ingredientRows = await db
      .select({
        id: manufacturingOrderIngredients.id,
      })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, orderId));

    expect(ingredientRows).toHaveLength(1);

    const allocations = await db
      .select({
        quantityUsed: manufacturingPickAllocations.quantityUsed,
        costPerUnit: manufacturingPickAllocations.costPerUnit,
      })
      .from(manufacturingPickAllocations)
      .where(
        eq(
          manufacturingPickAllocations.manufacturingOrderIngredientId,
          ingredientRows[0].id
        )
      );

    expect(allocations).toHaveLength(1);
    expect(allocations[0].quantityUsed).toBe("10.0000");
    expect(allocations[0].costPerUnit).toBe("0.769231");

    const completion = await completeManufacturingOrder(orderId, "1");
    expect(completion.status).toBe(200);

    const producedLots = await db
      .select({
        quantity: lots.quantity,
        costPerUnit: inventoryLotBalances.unitCost,
      })
      .from(lots)
      .innerJoin(inventoryLotBalances, eq(inventoryLotBalances.lotId, lots.id))
      .where(eq(lots.itemId, convertedProductId));

    expect(producedLots).toHaveLength(1);
    expect(producedLots[0].quantity).toBe("1.0000");
    expect(producedLots[0].costPerUnit).toBe("7.692310");
  });
});
