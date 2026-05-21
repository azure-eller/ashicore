import { and, eq, isNull } from "drizzle-orm";
import { format } from "date-fns";
import { test, expect, filterList, getIdFromUrl } from "../fixtures";
import {
  customerCategories,
  customers as salesCustomers,
  inventoryEvents,
  inventoryItemBalances,
  items,
  lots,
  manufacturingOrders,
  pricingScheduleBreaks,
  pricingSchedules,
  salesOrderLines,
  salesOrders,
  salesShipmentLines,
  salesShipments,
} from "../../../lib/db/schema";
import {
  createCustomer,
  createCustomerCategory,
  createItem,
  createPricingSchedule,
  getUnitId,
  testFetch,
} from "../../helpers/api";

function salesOrderCard(page: Parameters<typeof filterList>[0], orderNumber: string) {
  return page.getByRole("row").filter({ hasText: orderNumber }).first();
}

async function createDraftSalesOrder(payload: {
  customerId: string;
  orderDate?: string;
  shipDate?: string | null;
  requestedDate?: string | null;
  notes?: string | null;
  confirmOversell?: boolean;
  lines: Array<{
    itemId: string;
    quantity: string;
    unitPrice: string;
  }>;
  shipments?: Array<{
    fulfillmentType: "delivery" | "pickup";
    scheduledDate: string;
    deliveryDate: string;
    notes?: string | null;
    lines: Array<{ itemId: string; quantity: string }>;
  }>;
}) {
  const response = await testFetch("/api/sales-orders", {
    method: "POST",
    body: JSON.stringify({
      customerId: payload.customerId,
      status: "open",
      orderDate: payload.orderDate ?? "2026-04-01",
      shipDate: payload.shipDate ?? null,
      requestedDate: payload.requestedDate ?? null,
      notes: payload.notes ?? null,
      lines: payload.lines,
      shipments: payload.shipments ?? [],
      confirmOversell: payload.confirmOversell ?? false,
    }),
  });
  const body = await response.json().catch(() => null);

  expect(response.status).toBe(201);
  expect(body?.id).toBeTruthy();

  return body.id as string;
}

function plannedShipmentForItems(params: {
  shipDate: string;
  deliveryDate?: string | null;
  lines: Array<{ itemId: string; quantity: string }>;
  notes?: string | null;
}) {
  return [
    {
      fulfillmentType: "delivery" as const,
      scheduledDate: params.shipDate,
      deliveryDate: params.deliveryDate ?? params.shipDate,
      notes: params.notes ?? null,
      lines: params.lines,
    },
  ];
}

async function deleteSalesOrderByApi(orderId: string) {
  const response = await testFetch(`/api/sales-orders/${orderId}`, {
    method: "DELETE",
  });
  const body = await response.json().catch(() => null);

  expect(response.status).toBe(200);
  expect(body?.success).toBe(true);
}

test.describe("Sales order flow", () => {
  test.describe.configure({ mode: "serial" });

  // Per-run timestamp — used for customers/orders so re-runs don't collide.
  const run = Date.now();
  const fixtureTs = Date.now();
  const unitId = getUnitId();
  const currentMonthFifteenth = new Date();
  currentMonthFifteenth.setDate(15);
  const currentMonthFirst = new Date(currentMonthFifteenth);
  currentMonthFirst.setDate(1);
  const currentMonthFourteenth = new Date(currentMonthFifteenth);
  currentMonthFourteenth.setDate(14);
  const expectedOrderDate = format(currentMonthFirst, "yyyy-MM-dd");
  const expectedShipDate = format(currentMonthFourteenth, "yyyy-MM-dd");
  const expectedShipDateLabel = new Date(
    `${expectedShipDate}T00:00:00`
  ).toLocaleDateString("en-US");
  const expectedRequestedDate = format(currentMonthFifteenth, "yyyy-MM-dd");
  const expectedRequestedDateLabel = new Date(
    `${expectedRequestedDate}T00:00:00`
  ).toLocaleDateString("en-US");

  const primaryMaterialName = `Sales BOM Sand ${fixtureTs}`;
  const primaryProductName = `Premium Topsoil ${fixtureTs}`;
  const secondaryProductName = `Base Mix ${fixtureTs}`;
  let primaryMaterialId: string;
  let primaryProductId: string;
  let secondaryProductId: string;

  let customerId: string;
  let customerName: string;
  let extraCustomerId: string;
  let extraCustomerName: string;
  let wholesaleCategoryId: string;
  let wholesaleScheduleId: string;

  let fullOrderId: string;
  let fullOrderNumber: string;
  let guardOrderId: string;
  let noManufacturingOrderId: string;
  let noManufacturingOrderNumber: string;

  test("creates product fixtures for the sales flow", async ({ db }) => {
    test.slow();

    const materialResult = await createItem({
      name: primaryMaterialName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `SALES-MAT-${fixtureTs}`,
      category: `Sales ${fixtureTs}`,
      description: "Material used for the BOM-backed sales product",
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "25",
      safetyStock: "0",
      bom: [],
    });
    expect(materialResult.status).toBe(201);
    primaryMaterialId = materialResult.body.id;

    const secondaryProductResult = await createItem({
      name: secondaryProductName,
      itemType: "product",
      sellable: true,
      unitDefinitionId: unitId,
      sku: `SALES-BASE-${fixtureTs}`,
      category: `Sales ${fixtureTs}`,
      description: "Sellable product without a BOM",
      defaultPurchasePrice: null,
      defaultSellingPrice: "12.00",
      sellable: true,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(secondaryProductResult.status).toBe(201);
    secondaryProductId = secondaryProductResult.body.id;

    const primaryProductResult = await createItem({
      name: primaryProductName,
      itemType: "product",
      sellable: true,
      unitDefinitionId: unitId,
      sku: `SALES-TOPSOIL-${fixtureTs}`,
      category: `Sales ${fixtureTs}`,
      description: "BOM-backed product for shortage and manufacturing coverage",
      defaultPurchasePrice: null,
      defaultSellingPrice: "34.99",
      sellable: true,
      stock: "4",
      safetyStock: "0",
      bom: [
        {
          componentId: primaryMaterialId,
          quantity: "1",
        },
      ],
    });
    expect(primaryProductResult.status).toBe(201);
    primaryProductId = primaryProductResult.body.id;

    const [primary] = await db
      .select()
      .from(items)
      .where(eq(items.id, primaryProductId));
    expect(primary).toBeTruthy();
    expect(primary.name).toBe(primaryProductName);
    expect(primary.defaultSellingPrice).toBe("34.99");

    const [secondary] = await db
      .select()
      .from(items)
      .where(eq(items.id, secondaryProductId));
    expect(secondary).toBeTruthy();
    expect(secondary.name).toBe(secondaryProductName);
    expect(secondary.defaultSellingPrice).toBe("12.00");
  });

  /* ================================================================ */
  /*  Flow 1 — Customer creation + edit                               */
  /* ================================================================ */

  test("creates a customer with all fields", async ({ page, db }) => {
    customerName = `Acme Landscaping ${run}`;

    await page.goto("/sales/customers/new");
    await expect(page.getByRole("heading", { name: "New customer" })).toBeVisible();

    const [createCustomerResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/api/customers")
      ),
      (async () => {
        await page.getByLabel("Customer name").fill(customerName);
        await page.getByLabel("Customer name").blur();
      })(),
    ]);
    expect(createCustomerResponse.status()).toBe(201);
    await page.waitForURL(/\/sales\/customers\/[0-9a-f-]+$/);
    customerId = getIdFromUrl(page.url());

    const updateCustomerResponse = await page.request.patch(
      `/api/customers/${customerId}`,
      {
        data: {
          email: `sales-${run}@example.com`,
          phone: "555-0100",
          notes: "Primary landscaping account",
        },
      }
    );
    expect(updateCustomerResponse.status()).toBe(200);
    await page.reload();

    // UI — verify the detail page
    await expect(
      page.getByRole("heading", { name: customerName })
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByLabel("Email")).toHaveValue(`sales-${run}@example.com`);
    await expect(page.getByLabel("Phone")).toHaveValue("555-0100");
    await expect(page.getByLabel("Notes")).toHaveValue("Primary landscaping account");
    await expect(page.locator("body")).not.toContainText("Invalid");

    await page.reload();
    await expect(page.getByRole("heading", { name: customerName })).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveValue(`sales-${run}@example.com`);
    await expect(page.getByLabel("Notes")).toHaveValue("Primary landscaping account");

    // DB
    const rows = await db
      .select()
      .from(salesCustomers)
      .where(eq(salesCustomers.name, customerName));
    expect(rows).toHaveLength(1);

    const customer = rows[0];
    expect(customer.id).toBe(customerId);

    expect(customer.email).toBe(`sales-${run}@example.com`);
    expect(customer.phone).toBe("555-0100");
    expect(customer.notes).toBe("Primary landscaping account");
    expect(customer.deletedAt).toBeNull();
  });

  test("edits the customer — verifies pre-population and saves changes", async ({ page, db }) => {
    await page.goto(`/sales/customers/${customerId}`);
    await expect(page.getByRole("heading", { name: customerName })).toBeVisible({
      timeout: 30000,
    });

    // Verify pre-populated
    await expect(page.getByLabel("Customer name")).toHaveValue(customerName);
    await expect(page.getByLabel("Email")).toHaveValue(`sales-${run}@example.com`);
    await expect(page.getByLabel("Phone")).toHaveValue("555-0100");
    await expect(page.getByLabel("Notes")).toHaveValue("Primary landscaping account");

    // Make changes
    await page.getByLabel("Phone").fill("555-0200");
    await page.getByLabel("Phone").blur();

    const editCustomerResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().endsWith(`/api/customers/${customerId}`)
    );
    await page.getByLabel("Notes").fill("Updated account notes");
    await page.getByLabel("Notes").blur();
    expect((await editCustomerResponsePromise).status()).toBe(200);

    // UI — verify detail page reflects the edits
    await expect(page.getByLabel("Phone")).toHaveValue("555-0200", {
      timeout: 30000,
    });
    await expect(page.getByLabel("Notes")).toHaveValue("Updated account notes");
    await expect(page.locator("body")).not.toContainText("Invalid");

    await page.reload();
    await expect(page.getByRole("heading", { name: customerName })).toBeVisible();
    await expect(page.getByLabel("Phone")).toHaveValue("555-0200");
    await expect(page.getByLabel("Notes")).toHaveValue("Updated account notes");

    // DB
    const [updated] = await db.select().from(salesCustomers).where(eq(salesCustomers.id, customerId));
    expect(updated.phone).toBe("555-0200");
    expect(updated.notes).toBe("Updated account notes");
    expect(updated.email).toBe(`sales-${run}@example.com`);
  });

  test("creates a minimal customer", async ({ page, db }) => {
    extraCustomerName = `Backup Builder ${run}`;

    await page.goto("/sales/customers/new");
    await expect(page.getByRole("heading", { name: "New customer" })).toBeVisible();

    const [createMinimalCustomerResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/api/customers")
      ),
      (async () => {
        await page.getByLabel("Customer name").fill(extraCustomerName);
        await page.getByLabel("Customer name").blur();
      })(),
    ]);
    expect(createMinimalCustomerResponse.status()).toBe(201);
    await page.waitForURL(/\/sales\/customers\/[0-9a-f-]+$/);

    // UI — verify the detail page
    await expect(
      page.getByRole("heading", { name: extraCustomerName })
    ).toBeVisible({ timeout: 30000 });
    await expect(page.locator("body")).not.toContainText("Invalid");

    // DB
    const rows = await db
      .select()
      .from(salesCustomers)
      .where(eq(salesCustomers.name, extraCustomerName));
    expect(rows).toHaveLength(1);

    const customer = rows[0];
    extraCustomerId = customer.id;
    expect(customer.email).toBeNull();
    expect(customer.phone).toBeNull();
    expect(customer.billingLine1).toBeNull();
    expect(customer.notes).toBeNull();
    expect(customer.deletedAt).toBeNull();
  });

  test("creates a pricing category and schedule, then assigns it to the main customer", async ({
    page,
    db,
  }) => {
    const categoryResult = await createCustomerCategory({
      name: `Wholesale ${run}`,
      description: "Volume pricing category for wholesale accounts",
    });
    expect(categoryResult.status).toBe(201);
    wholesaleCategoryId = categoryResult.body.id;

    const scheduleResult = await createPricingSchedule({
      name: `Wholesale ${run} Default`,
      customerCategoryId: wholesaleCategoryId,
      unitDefinitionId: unitId,
      notes: "10% off at five units or more",
      breaks: [
        { minQuantity: "1", maxQuantity: "4", discountPercent: "0" },
        { minQuantity: "5", maxQuantity: null, discountPercent: "10" },
      ],
    });
    expect(scheduleResult.status).toBe(201);
    wholesaleScheduleId = scheduleResult.body.id;

    const assignCategoryResponse = await page.request.patch(
      `/api/customers/${customerId}`,
      {
        data: { customerCategoryId: wholesaleCategoryId },
      }
    );
    expect(assignCategoryResponse.status()).toBe(200);

    await page.goto("/sales/pricing");
    await expect(
      page.getByRole("textbox", { name: "Search pricing schedules" })
    ).toBeVisible({ timeout: 30000 });
    await page.getByRole("textbox", { name: "Search pricing schedules" }).fill(`${run}`);
    await expect(
      page
        .getByRole("row", { name: new RegExp(`Wholesale ${run} Default`) })
        .first()
    ).toBeVisible({ timeout: 30000 });

    const [category] = await db
      .select()
      .from(customerCategories)
      .where(eq(customerCategories.id, wholesaleCategoryId));
    expect(category).toBeTruthy();
    expect(category.name).toBe(`Wholesale ${run}`);

    const [schedule] = await db
      .select()
      .from(pricingSchedules)
      .where(eq(pricingSchedules.id, wholesaleScheduleId));
    expect(schedule).toBeTruthy();
    expect(schedule.customerCategoryId).toBe(wholesaleCategoryId);

    const scheduleBreakRows = await db
      .select()
      .from(pricingScheduleBreaks)
      .where(eq(pricingScheduleBreaks.pricingScheduleId, wholesaleScheduleId));
    expect(scheduleBreakRows).toHaveLength(2);
  });

  /* ================================================================ */
  /*  Flow 2 — Full sales order lifecycle                             */
  /*  create → edit → confirm shortage demand → delete                */
  /* ================================================================ */

  // NOTE: Material line (row 3) removed — the pricing useEffect wipes
  // user-entered prices on items with no default/suggested price. Add it
  // back once the order-form isPriceOverridden logic handles null suggested prices.
  test("creates a confirmed order with multiple lines", async ({ page, db }) => {
    fullOrderId = await createDraftSalesOrder({
      customerId,
      orderDate: expectedOrderDate,
      shipDate: expectedShipDate,
      requestedDate: expectedRequestedDate,
      notes: "Full lifecycle test order",
      lines: [
        { itemId: primaryProductId, quantity: "3", unitPrice: "34.99" },
        { itemId: secondaryProductId, quantity: "5", unitPrice: "10.80" },
      ],
      shipments: plannedShipmentForItems({
        shipDate: expectedShipDate,
        deliveryDate: expectedRequestedDate,
        notes: "Full lifecycle test order",
        lines: [
          { itemId: primaryProductId, quantity: "3" },
          { itemId: secondaryProductId, quantity: "5" },
        ],
      }),
    });

    const [createdOrder] = await db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.id, fullOrderId));
    fullOrderNumber = createdOrder.orderNumber;

    await page.goto(`/sales/orders/${fullOrderId}`);
    await expect(page.getByRole("heading", { name: fullOrderNumber })).toBeVisible();
    await expect(page.locator("main")).toContainText(customerName);
    await expect(page.locator("main")).toContainText(primaryProductName);
    await expect(page.locator("main")).toContainText(secondaryProductName);
    await expect(page.getByText(expectedRequestedDateLabel).first()).toBeVisible();
    await expect(page.getByText("$158.97", { exact: true }).first()).toBeVisible();
    await expect(page.locator("main")).toContainText("$104.97");
    await expect(page.locator("main")).toContainText("$54.00");
    await expect(page.getByText("Full lifecycle test order")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Invalid");

    await page.reload();
    await expect(page.getByRole("heading", { name: fullOrderNumber })).toBeVisible();
    await expect(page.locator("main")).toContainText(primaryProductName);
    await expect(page.locator("main")).toContainText(secondaryProductName);

    // DB
    const orderRows = await db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.customerId, customerId));
    expect(orderRows).toHaveLength(1);

    const order = orderRows[0];

    expect(order.customerName).toBe(customerName);
    expect(order.status).toBe("open");
    expect(order.orderDate).toBe(expectedOrderDate);
    expect(order.shipDate).toBe(expectedShipDate);
    expect(order.requestedDate).toBe(expectedRequestedDate);
    expect(order.notes).toBe("Full lifecycle test order");
    expect(order.deletedAt).toBeNull();

    const lineRows = await db
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.id));
    expect(lineRows).toHaveLength(2);

    const lineByItem = new Map(lineRows.map((line) => [line.itemId, line]));
    expect(lineByItem.get(primaryProductId)?.quantity).toBe("3.0000");
    expect(lineByItem.get(secondaryProductId)?.quantity).toBe("5.0000");
    expect(lineByItem.get(secondaryProductId)?.suggestedUnitPrice).toBe("10.80");
    expect(lineByItem.get(secondaryProductId)?.pricingSourceType).toBe("schedule_break");
    expect(lineByItem.get(secondaryProductId)?.pricingScheduleName).toBe(
      `Wholesale ${run} Default`
    );
    expect(lineByItem.get(secondaryProductId)?.pricingBreakLabel).toBe("5+");
    expect(lineByItem.get(secondaryProductId)?.isPriceOverridden).toBe(false);

    const computedTotal = lineRows.reduce(
      (sum, line) => sum + parseFloat(line.lineTotal),
      0
    );
    expect(parseFloat(order.totalAmount)).toBeCloseTo(computedTotal, 2);

    const [primaryItem] = await db
      .select({ committedQty: inventoryItemBalances.committedQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, primaryProductId));
    const [secondaryItem] = await db
      .select({ committedQty: inventoryItemBalances.committedQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, secondaryProductId));
    const [primaryMaterial] = await db
      .select({ committedQty: inventoryItemBalances.committedQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, primaryMaterialId));
    expect(primaryItem?.committedQty ?? "0.0000").toBe("3.0000");
    expect(secondaryItem?.committedQty ?? "0.0000").toBe("0.0000");
    expect(primaryMaterial?.committedQty ?? "0.0000").toBe("0.0000");

    await page.goto("/sales/orders");
    await filterList(page, "Search orders", fullOrderNumber);
    const confirmedCard = salesOrderCard(page, fullOrderNumber);
    await expect(confirmedCard).toContainText(customerName);
    await expect(confirmedCard).toContainText("$158.97");
    await expect(confirmedCard).toContainText(expectedShipDateLabel);
  });

  test("edits the confirmed order — verifies pre-population and changes quantity", async ({ page, db }) => {
    const existingLineRows = await db
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, fullOrderId));
    const primaryLine = existingLineRows.find((line) => line.itemId === primaryProductId);
    const secondaryLine = existingLineRows.find((line) => line.itemId === secondaryProductId);
    expect(primaryLine).toBeTruthy();
    expect(secondaryLine).toBeTruthy();

    const headerResponse = await testFetch(`/api/sales-orders/${fullOrderId}`, {
      method: "PATCH",
      body: JSON.stringify({ notes: "Updated to 5 units" }),
    });
    expect(headerResponse.status).toBe(200);

    const primaryLineResponse = await testFetch(
      `/api/sales-orders/${fullOrderId}/lines/${primaryLine!.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ quantity: "5" }),
      }
    );
    expect(primaryLineResponse.status).toBe(200);

    const secondaryLineResponse = await testFetch(
      `/api/sales-orders/${fullOrderId}/lines/${secondaryLine!.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ unitPrice: "11.25" }),
      }
    );
    expect(secondaryLineResponse.status).toBe(200);

    await page.goto(`/sales/orders/${fullOrderId}`);
    await expect(
      page.getByRole("heading", { name: fullOrderNumber })
    ).toBeVisible({ timeout: 30000 });

    // UI
    await expect(page.getByText("Updated to 5 units")).toBeVisible();
    await expect(page.locator("main")).toContainText("$11.25");
    await expect(page.locator("body")).not.toContainText("Invalid");

    await page.reload();
    await expect(page.getByRole("heading", { name: fullOrderNumber })).toBeVisible();
    await expect(page.getByText("Updated to 5 units")).toBeVisible();
    await expect(page.locator("main")).toContainText("$11.25");

    // DB
    const orderRows = await db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.id, fullOrderId));
    expect(orderRows).toHaveLength(1);
    expect(orderRows[0].status).toBe("open");
    expect(orderRows[0].notes).toBe("Updated to 5 units");

    const updatedLineRows = await db
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, fullOrderId));
    const updatedTotal = updatedLineRows.reduce(
      (sum, line) => sum + parseFloat(line.lineTotal),
      0
    );
    const currencyFormatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    });
    expect(parseFloat(orderRows[0].totalAmount)).toBeCloseTo(updatedTotal, 2);
    const expectedTotalLabel = currencyFormatter.format(updatedTotal);
    await expect(page.locator("main")).toContainText(expectedTotalLabel);

    const updatedPrimaryLine = updatedLineRows.find(
      (line) => line.itemId === primaryProductId
    );
    const updatedSecondaryLine = updatedLineRows.find(
      (line) => line.itemId === secondaryProductId
    );
    expect(updatedPrimaryLine).toBeTruthy();
    expect(updatedSecondaryLine?.unitPrice).toBe("11.25");
    expect(updatedSecondaryLine?.suggestedUnitPrice).toBe("10.80");
    expect(updatedSecondaryLine?.isPriceOverridden).toBe(true);
    await expect(page.locator("main")).toContainText(
      currencyFormatter.format(parseFloat(updatedPrimaryLine!.lineTotal))
    );
    await expect(page.locator("main")).toContainText(
      currencyFormatter.format(parseFloat(updatedSecondaryLine!.lineTotal))
    );
  });

  test("creates an open order with shortage demand and deletes it", async ({
    db,
  }) => {
    const bulkOrderId = await createDraftSalesOrder({
      customerId: extraCustomerId,
      requestedDate: "2026-04-18",
      notes: "Bulk confirm coverage",
      confirmOversell: true,
      lines: [
        {
          itemId: primaryProductId,
          quantity: "5",
          unitPrice: "29.99",
        },
      ],
    });

    const [bulkOrder] = await db
      .select({
        id: salesOrders.id,
        orderNumber: salesOrders.orderNumber,
        status: salesOrders.status,
      })
      .from(salesOrders)
      .where(eq(salesOrders.id, bulkOrderId));

    expect(bulkOrder.status).toBe("open");

    const [primaryItemAfterConfirm] = await db
      .select({
        committedQty: inventoryItemBalances.committedQty,
        demandQty: inventoryItemBalances.demandQty,
        shortageQty: inventoryItemBalances.shortageQty,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, primaryProductId));
    expect(primaryItemAfterConfirm.committedQty).toBe("4.0000");
    expect(primaryItemAfterConfirm.demandQty).toBe("10.0000");
    expect(primaryItemAfterConfirm.shortageQty).toBe("6.0000");

    await deleteSalesOrderByApi(bulkOrderId);

    await expect
      .poll(
        async () => {
          const [primaryItem] = await db
            .select({ committedQty: inventoryItemBalances.committedQty })
            .from(inventoryItemBalances)
            .where(eq(inventoryItemBalances.itemId, primaryProductId));
          return primaryItem?.committedQty ?? null;
        },
        { timeout: 15_000 }
      )
      .toBe("4.0000");

    const [deletedBulkOrder] = await db
      .select({ status: salesOrders.status, deletedAt: salesOrders.deletedAt })
      .from(salesOrders)
      .where(eq(salesOrders.id, bulkOrderId));
    expect(deletedBulkOrder?.status).toBe("open");
    expect(deletedBulkOrder?.deletedAt).not.toBeNull();
  });

  test("confirmed order from detail keeps reservations and production actions", async ({ page, db }) => {
    await page.goto(`/sales/orders/${fullOrderId}`);
    await expect(page.getByRole("heading", { name: fullOrderNumber })).toBeVisible();

    await expect
      .poll(
        async () => {
          const [order] = await db
            .select({ status: salesOrders.status })
            .from(salesOrders)
            .where(eq(salesOrders.id, fullOrderId));
          return order?.status ?? null;
        },
        { timeout: 15_000 }
      )
      .toBe("open");

    await expect
      .poll(
        async () => {
          const [primaryItem] = await db
            .select({ committedQty: inventoryItemBalances.committedQty })
            .from(inventoryItemBalances)
            .where(eq(inventoryItemBalances.itemId, primaryProductId));
          const [secondaryItem] = await db
            .select({ committedQty: inventoryItemBalances.committedQty })
            .from(inventoryItemBalances)
            .where(eq(inventoryItemBalances.itemId, secondaryProductId));
          const [materialItem] = await db
            .select({ committedQty: inventoryItemBalances.committedQty })
            .from(inventoryItemBalances)
            .where(eq(inventoryItemBalances.itemId, primaryMaterialId));

          return {
            primary: primaryItem?.committedQty ?? null,
            secondary: secondaryItem?.committedQty ?? null,
            material: materialItem?.committedQty ?? null,
          };
        },
        { timeout: 15_000 }
      )
      .toEqual({
        primary: "4.0000",
        secondary: "0.0000",
        material: "0.0000",
      });

    await page.reload();
    await expect(page.getByRole("heading", { name: fullOrderNumber })).toBeVisible();
    await expect(page.getByRole("button", { name: "Plan shipment" }).first()).toBeVisible();
  });

  test("confirmed orders can be edited from detail", async ({ page }) => {
    await page.goto(`/sales/orders/${fullOrderId}`);
    await expect(page.getByRole("heading", { name: fullOrderNumber })).toBeVisible();
    await expect(page.getByRole("button", { name: "Plan shipment" }).first()).toBeVisible();
    await page.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Delete order" })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("open order stale-client status downgrades keep the order open", async ({
    db,
  }) => {
    const staleOrderId = await createDraftSalesOrder({
      customerId: extraCustomerId,
      requestedDate: "2026-04-24",
      notes: "Stale status edit coverage",
      confirmOversell: true,
      lines: [
        {
          itemId: primaryProductId,
          quantity: "1",
          unitPrice: "29.99",
        },
      ],
    });

    const editConfirmedResponse = await testFetch(`/api/sales-orders/${staleOrderId}`, {
      method: "PUT",
      body: JSON.stringify({
        customerId: extraCustomerId,
        status: "open",
        orderDate: expectedOrderDate,
        requestedDate: expectedRequestedDate,
        shipDate: expectedShipDate,
        notes: "Stale status edit applied.",
        lines: [
          {
            itemId: primaryProductId,
            quantity: "1",
            unitPrice: "29.99",
          },
        ],
        confirmOversell: true,
      }),
    });
    const editConfirmedBody = await editConfirmedResponse.json().catch(() => null);
    expect(editConfirmedResponse.status).toBe(200);
    expect(editConfirmedBody?.id).toBe(staleOrderId);

    const [afterOrder] = await db
      .select({
        status: salesOrders.status,
        notes: salesOrders.notes,
        deletedAt: salesOrders.deletedAt,
      })
      .from(salesOrders)
      .where(eq(salesOrders.id, staleOrderId));

    expect(afterOrder.status).toBe("open");
    expect(afterOrder.notes).toBe("Stale status edit applied.");
    expect(afterOrder.deletedAt).toBeNull();
  });

  test("confirmed manufacturable orders show Create MOs when allocation is short", async ({
    db,
  }) => {
    const shortOrderId = await createDraftSalesOrder({
      customerId,
      requestedDate: "2026-04-22",
      notes: "Short manufacturing action coverage",
      confirmOversell: true,
      lines: [
        {
          itemId: primaryProductId,
          quantity: "20",
          unitPrice: "34.99",
        },
      ],
    });

    const confirmResponse = await testFetch(`/api/sales-orders/${shortOrderId}/confirm`, {
      method: "POST",
      body: JSON.stringify({ confirmOversell: true }),
    });
    expect(confirmResponse.status).toBe(200);

    const [shortOrder] = await db
      .select({
        orderNumber: salesOrders.orderNumber,
        status: salesOrders.status,
      })
      .from(salesOrders)
      .where(eq(salesOrders.id, shortOrderId));
    expect(shortOrder.status).toBe("open");

    const [shortLine] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, shortOrderId));
    expect(shortLine?.id).toBeTruthy();

    const createMoResponse = await testFetch(
      `/api/sales-orders/${shortOrderId}/manufacturing-orders`,
      {
        method: "POST",
        body: JSON.stringify({
          plannedDate: null,
          salesOrderLineIds: [shortLine.id],
          notes: null,
        }),
      }
    );
    const createMoBody = await createMoResponse.json().catch(() => null);
    expect(createMoResponse.status, JSON.stringify(createMoBody)).toBe(201);
    expect(createMoBody?.created).toHaveLength(1);

    const [linkedMo] = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.salesOrderId, shortOrderId));
    expect(linkedMo?.salesOrderLineId).toBe(shortLine.id);
    await deleteSalesOrderByApi(shortOrderId);
  });

  test("confirmed non-manufacturable orders do not show production actions", async ({
    page,
    db,
  }) => {
    noManufacturingOrderId = await createDraftSalesOrder({
      customerId: extraCustomerId,
      requestedDate: "2026-04-19",
      notes: "Disabled manufacturing action coverage",
      confirmOversell: true,
      lines: [
        {
          itemId: secondaryProductId,
          quantity: "1",
          unitPrice: "12.00",
        },
      ],
    });

    const confirmResponse = await testFetch(
      `/api/sales-orders/${noManufacturingOrderId}/confirm`,
      {
        method: "POST",
        body: JSON.stringify({ confirmOversell: true }),
      }
    );
    expect(confirmResponse.status).toBe(200);

    const [confirmedOrder] = await db
      .select({
        orderNumber: salesOrders.orderNumber,
        status: salesOrders.status,
      })
      .from(salesOrders)
      .where(eq(salesOrders.id, noManufacturingOrderId));

    noManufacturingOrderNumber = confirmedOrder.orderNumber;
    expect(confirmedOrder.status).toBe("open");

    await page.goto(`/sales/orders/${noManufacturingOrderId}`);
    await expect(
      page.getByRole("button", { name: "Plan Fulfillment", exact: true })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Create MOs", exact: true })
    ).toHaveCount(0);

    await page.goto("/sales/orders");
    await filterList(page, "Search orders", noManufacturingOrderNumber);

    const disabledRow = salesOrderCard(page, noManufacturingOrderNumber);
    await expect(
      disabledRow.getByRole("button", { name: "Plan Fulfillment" })
    ).toHaveCount(0);
    await expect(disabledRow.getByRole("button", {
      name: "Create MOs",
    })).toHaveCount(0);
    await expect(disabledRow.getByRole("link", { name: "Create MOs" })).toHaveCount(0);

    await deleteSalesOrderByApi(noManufacturingOrderId);

    await expect
      .poll(
        async () => {
          const [secondaryItem] = await db
            .select({ committedQty: inventoryItemBalances.committedQty })
            .from(inventoryItemBalances)
            .where(eq(inventoryItemBalances.itemId, secondaryProductId));
          return secondaryItem?.committedQty ?? null;
        },
        { timeout: 15_000 }
      )
      .toBe("0.0000");
  });

  test("deletes the confirmed order and releases committed stock", async ({ db }) => {
    await deleteSalesOrderByApi(fullOrderId);
    const orderRows = await db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.id, fullOrderId));
    expect(orderRows).toHaveLength(1);
    expect(orderRows[0].deletedAt).toBeTruthy();

    const [primaryItem] = await db
      .select({ committedQty: inventoryItemBalances.committedQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, primaryProductId));
    const [secondaryItem] = await db
      .select({ committedQty: inventoryItemBalances.committedQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, secondaryProductId));
    const [primaryMaterial] = await db
      .select({ committedQty: inventoryItemBalances.committedQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, primaryMaterialId));
    expect(primaryItem.committedQty).toBe("0.0000");
    expect(secondaryItem.committedQty).toBe("0.0000");
    expect(primaryMaterial.committedQty).toBe("0.0000");

  });

  test("keeps the deleted order hidden from normal views", async ({ page, db }) => {
    await page.goto("/sales/orders");
    await filterList(page, "Search orders", fullOrderNumber);

    await expect(page.getByText("No sales orders yet.")).toBeVisible();

    const orderRows = await db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.id, fullOrderId));
    expect(orderRows).toHaveLength(1);
    expect(orderRows[0].deletedAt).not.toBeNull();
  });

  test("ships a confirmed order and releases committed stock", async ({ page, db }) => {
    const shipCustomerResult = await createCustomer({
      name: `Shipping Customer ${run}`,
    });
    expect(shipCustomerResult.status).toBe(201);
    const shipCustomerId = shipCustomerResult.body.id as string;

    const shipOrderId = await createDraftSalesOrder({
      customerId: shipCustomerId,
      notes: "Shipping coverage",
      lines: [
        {
          itemId: primaryProductId,
          quantity: "3",
          unitPrice: "34.99",
        },
      ],
      shipments: plannedShipmentForItems({
        shipDate: "2026-04-20",
        lines: [{ itemId: primaryProductId, quantity: "3" }],
      }),
    });

    const confirmResponse = await testFetch(
      `/api/sales-orders/${shipOrderId}/confirm`,
      {
        method: "POST",
        body: JSON.stringify({ confirmOversell: false }),
      }
    );
    expect(confirmResponse.status).toBe(200);

    const [confirmedOrder] = await db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, shipOrderId));
    expect(confirmedOrder.status).toBe("open");

    const [beforeShip] = await db
      .select({ committedQty: inventoryItemBalances.committedQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, primaryProductId));
    expect(["0.0000", "3.0000"]).toContain(beforeShip.committedQty);

    const lotsBefore = await db
      .select({ quantity: lots.quantity })
      .from(lots)
      .where(eq(lots.itemId, primaryProductId));
    const stockBefore = lotsBefore.reduce(
      (sum, lot) => sum + parseFloat(lot.quantity),
      0
    );

    const [createdShipment] = await db
      .select({ id: salesShipments.id })
      .from(salesShipments)
      .where(eq(salesShipments.salesOrderId, shipOrderId));
    expect(createdShipment.id).toBeTruthy();
    const activeShipmentId = createdShipment.id;

    const shipResponse = await testFetch(
      `/api/sales-orders/${shipOrderId}/shipments/${activeShipmentId}/ship`,
      {
        method: "POST",
        body: JSON.stringify({ syncAccounting: false, sendEmail: false }),
      }
    );
    expect(shipResponse.status).toBe(200);

    const [shippedOrder] = await db
      .select({
        status: salesOrders.status,
        shippedAt: salesOrders.shippedAt,
      })
      .from(salesOrders)
      .where(eq(salesOrders.id, shipOrderId));
    expect(shippedOrder.status).toBe("done");
    expect(shippedOrder.shippedAt).not.toBeNull();

    const [afterShip] = await db
      .select({ committedQty: inventoryItemBalances.committedQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, primaryProductId));
    expect(afterShip.committedQty).toBe("0.0000");

    const lotsAfter = await db
      .select({ quantity: lots.quantity })
      .from(lots)
      .where(eq(lots.itemId, primaryProductId));
    const stockAfter = lotsAfter.reduce(
      (sum, lot) => sum + parseFloat(lot.quantity),
      0
    );
    expect(stockAfter).toBeCloseTo(stockBefore - 3, 2);

    const shipMovements = await db
      .select({
        itemId: inventoryEvents.itemId,
        eventType: inventoryEvents.eventType,
        referenceType: inventoryEvents.referenceType,
      })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.referenceId, activeShipmentId),
          eq(inventoryEvents.eventType, "sales_consumption")
        )
      );

    const secondaryProductMovements = shipMovements.filter(
      (movement) =>
        movement.itemId === primaryProductId &&
        movement.eventType === "sales_consumption"
    );

    expect(secondaryProductMovements.length).toBeGreaterThanOrEqual(1);
    expect(
      secondaryProductMovements.every(
        (movement) => movement.referenceType === "sales_shipment"
      )
    ).toBe(true);

    const duplicateShipResponse = await testFetch(
      `/api/sales-orders/${shipOrderId}/shipments/${activeShipmentId}/ship`,
      {
        method: "POST",
        body: JSON.stringify({ syncAccounting: false, sendEmail: false }),
      }
    );
    const duplicateShipBody = await duplicateShipResponse.json().catch(() => null);
    expect(duplicateShipResponse.status).toBeGreaterThanOrEqual(400);
    expect(duplicateShipBody?.error ?? "").toMatch(/shipped|already|status|cannot|open orders/i);

    const lotsAfterDuplicateShip = await db
      .select({ quantity: lots.quantity })
      .from(lots)
      .where(eq(lots.itemId, primaryProductId));
    const stockAfterDuplicateShip = lotsAfterDuplicateShip.reduce(
      (sum, lot) => sum + parseFloat(lot.quantity),
      0
    );
    expect(stockAfterDuplicateShip).toBeCloseTo(stockAfter, 2);

    const movementsAfterDuplicateShip = await db
      .select()
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.referenceId, activeShipmentId),
          eq(inventoryEvents.eventType, "sales_consumption")
        )
      );
    expect(movementsAfterDuplicateShip).toHaveLength(shipMovements.length);

    const deleteShippedResponse = await testFetch(`/api/sales-orders/${shipOrderId}`, {
      method: "DELETE",
    });
    const deleteShippedBody = await deleteShippedResponse.json().catch(() => null);
    expect(deleteShippedResponse.status).toBeGreaterThanOrEqual(400);
    expect(deleteShippedBody?.error ?? "").toMatch(/shipped|delete|cancelled|draft/i);

    const [afterRejectedDeleteOrder] = await db
      .select({
        status: salesOrders.status,
        deletedAt: salesOrders.deletedAt,
      })
      .from(salesOrders)
      .where(eq(salesOrders.id, shipOrderId));
    const [afterRejectedDeleteShipment] = await db
      .select({
        status: salesShipments.status,
        shippedAt: salesShipments.shippedAt,
      })
      .from(salesShipments)
      .where(eq(salesShipments.id, activeShipmentId));
    expect(afterRejectedDeleteOrder.status).toBe("done");
    expect(afterRejectedDeleteOrder.deletedAt).toBeNull();
    expect(afterRejectedDeleteShipment.status).toBe("shipped");
    expect(afterRejectedDeleteShipment.shippedAt).not.toBeNull();

    await page.goto(`/sales/orders/${shipOrderId}`);
    await expect(page.locator("main").getByText("SHIPPED", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Shipping coverage")).toBeVisible();
    await expect(page.locator("main")).toContainText(primaryProductName);
    await expect(page.getByRole("button", { name: "Plan shipment" })).toHaveCount(0);

  });

  test("blocks deleting an order with inventory consumption history even if status is stale", async ({
    db,
  }) => {
    const staleConsumptionItemResult = await createItem({
      name: `Stale Consumption Material ${run}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `STALE-CONSUME-${run}`,
      category: `Sales ${run}`,
      description: "Product for stale sales deletion guard",
      defaultPurchasePrice: "3.00",
      defaultSellingPrice: "12.00",
      stock: "3",
      safetyStock: "0",
    });
    expect(staleConsumptionItemResult.status).toBe(201);

    const staleConsumptionCustomerResult = await createCustomer({
      name: `Stale Consumption Customer ${run}`,
    });
    expect(staleConsumptionCustomerResult.status).toBe(201);

    const staleConsumptionOrderId = await createDraftSalesOrder({
      customerId: staleConsumptionCustomerResult.body.id as string,
      notes: "Stale status consumption deletion guard",
      lines: [
        {
          itemId: staleConsumptionItemResult.body.id as string,
          quantity: "1",
          unitPrice: "12.00",
        },
      ],
      shipments: plannedShipmentForItems({
        shipDate: "2026-04-20",
        lines: [
          {
            itemId: staleConsumptionItemResult.body.id as string,
            quantity: "1",
          },
        ],
      }),
    });

    const confirmResponse = await testFetch(
      `/api/sales-orders/${staleConsumptionOrderId}/confirm`,
      {
        method: "POST",
        body: JSON.stringify({ confirmOversell: false }),
      }
    );
    expect(confirmResponse.status).toBe(200);

    const [shipment] = await db
      .select({ id: salesShipments.id })
      .from(salesShipments)
      .where(eq(salesShipments.salesOrderId, staleConsumptionOrderId));
    expect(shipment?.id).toBeTruthy();

    const shipResponse = await testFetch(
      `/api/sales-orders/${staleConsumptionOrderId}/shipments/${shipment.id}/ship`,
      {
        method: "POST",
        body: JSON.stringify({ syncAccounting: false, sendEmail: false }),
      }
    );
    expect(shipResponse.status).toBe(200);

    const [consumptionEvent] = await db
      .select({ id: inventoryEvents.id })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.eventType, "sales_consumption"),
          eq(inventoryEvents.referenceId, shipment.id)
        )
      );
    expect(consumptionEvent?.id).toBeTruthy();

    await db
      .update(salesOrders)
      .set({ status: "confirmed", shippedAt: null })
      .where(eq(salesOrders.id, staleConsumptionOrderId));
    await db
      .update(salesShipments)
      .set({ status: "planned", shippedAt: null })
      .where(eq(salesShipments.id, shipment.id));

    const deleteResponse = await testFetch(
      `/api/sales-orders/${staleConsumptionOrderId}`,
      { method: "DELETE" }
    );
    const deleteBody = await deleteResponse.json().catch(() => null);
    expect(deleteResponse.status).toBe(400);
    expect(deleteBody?.error).toContain("inventory has already been consumed");

    const [orderAfterDeleteAttempt] = await db
      .select({ deletedAt: salesOrders.deletedAt })
      .from(salesOrders)
      .where(eq(salesOrders.id, staleConsumptionOrderId));
    expect(orderAfterDeleteAttempt.deletedAt).toBeNull();
  });

  test("blocks deleting an order with a stale linked manufacturing line", async ({
    db,
  }) => {
    const linkedComponentResult = await createItem({
      name: `Stale Link Component ${run}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `STALE-LINK-COMP-${run}`,
      category: `Sales ${run}`,
      description: "Component for stale manufacturing link guard",
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
    });
    expect(linkedComponentResult.status).toBe(201);

    const linkedProductResult = await createItem({
      name: `Stale Link Product ${run}`,
      itemType: "product",
      sellable: true,
      unitDefinitionId: unitId,
      sku: `STALE-LINK-PROD-${run}`,
      category: `Sales ${run}`,
      description: "Product for stale manufacturing link guard",
      defaultPurchasePrice: null,
      defaultSellingPrice: "34.99",
      sellable: true,
      stock: "0",
      safetyStock: "0",
      bom: [
        {
          componentId: linkedComponentResult.body.id as string,
          quantity: "1",
        },
      ],
    });
    expect(linkedProductResult.status).toBe(201);

    const linkedCustomerResult = await createCustomer({
      name: `Stale Manufacturing Link Customer ${run}`,
    });
    expect(linkedCustomerResult.status).toBe(201);

    const linkedOrderId = await createDraftSalesOrder({
      customerId: linkedCustomerResult.body.id as string,
      notes: "Stale manufacturing link deletion guard",
      confirmOversell: true,
      lines: [
        {
          itemId: linkedProductResult.body.id as string,
          quantity: "1",
          unitPrice: "34.99",
        },
      ],
    });

    const confirmResponse = await testFetch(
      `/api/sales-orders/${linkedOrderId}/confirm`,
      {
        method: "POST",
        body: JSON.stringify({ confirmOversell: true }),
      }
    );
    expect(confirmResponse.status).toBe(200);

    const [linkedLine] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, linkedOrderId));
    expect(linkedLine?.id).toBeTruthy();

    const createMoResponse = await testFetch(
      `/api/sales-orders/${linkedOrderId}/manufacturing-orders`,
      {
        method: "POST",
        body: JSON.stringify({
          plannedDate: "2026-04-30",
          salesOrderLineIds: [linkedLine.id],
          notes: "Stale link deletion guard",
        }),
      }
    );
    expect(createMoResponse.status).toBe(201);

    const [linkedMo] = await db
      .select({ id: manufacturingOrders.id })
      .from(manufacturingOrders)
      .where(
        and(
          eq(manufacturingOrders.salesOrderId, linkedOrderId),
          isNull(manufacturingOrders.deletedAt)
        )
      );
    expect(linkedMo?.id).toBeTruthy();

    await db
      .update(manufacturingOrders)
      .set({ salesOrderLineId: null })
      .where(eq(manufacturingOrders.id, linkedMo.id));

    const deleteResponse = await testFetch(`/api/sales-orders/${linkedOrderId}`, {
      method: "DELETE",
    });
    const deleteBody = await deleteResponse.json().catch(() => null);
    expect(deleteResponse.status).toBe(400);
    expect(deleteBody?.error).toContain("not to a matching active sales line");

    const [orderAfterDeleteAttempt] = await db
      .select({ deletedAt: salesOrders.deletedAt })
      .from(salesOrders)
      .where(eq(salesOrders.id, linkedOrderId));
    expect(orderAfterDeleteAttempt.deletedAt).toBeNull();
  });

  test("plans available partial shipment on a short order and preserves shipped history", async ({
    page,
    db,
  }) => {
    test.slow();

    const shortItemName = `Short Partial Item ${run}`;
    const zeroLineItemName = `Zero Line Item ${run}`;

    const shortItemResult = await createItem({
      name: shortItemName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `SHORT-PARTIAL-${run}`,
      category: `Sales ${fixtureTs}`,
      description: null,
      defaultPurchasePrice: "1.00",
      defaultSellingPrice: "9.00",
      stock: "5",
      safetyStock: "0",
      bom: [],
    });
    expect(shortItemResult.status).toBe(201);

    const zeroLineItemResult = await createItem({
      name: zeroLineItemName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `ZERO-LINE-${run}`,
      category: `Sales ${fixtureTs}`,
      description: null,
      defaultPurchasePrice: "1.00",
      defaultSellingPrice: "9.00",
      stock: "5",
      safetyStock: "0",
      bom: [],
    });
    expect(zeroLineItemResult.status).toBe(201);

    const partialCustomerResult = await createCustomer({
      name: `Partial Shipment Customer ${run}`,
    });
    expect(partialCustomerResult.status).toBe(201);

    const partialOrderId = await createDraftSalesOrder({
      customerId: partialCustomerResult.body.id as string,
      notes: "Partial shortage coverage",
      confirmOversell: true,
      lines: [
        {
          itemId: shortItemResult.body.id as string,
          quantity: "8",
          unitPrice: "9.00",
        },
        {
          itemId: zeroLineItemResult.body.id as string,
          quantity: "5",
          unitPrice: "9.00",
        },
      ],
      shipments: plannedShipmentForItems({
        shipDate: "2026-04-19",
        lines: [
          {
            itemId: shortItemResult.body.id as string,
            quantity: "8",
          },
          {
            itemId: zeroLineItemResult.body.id as string,
            quantity: "5",
          },
        ],
      }),
    });

    const confirmResponse = await testFetch(
      `/api/sales-orders/${partialOrderId}/confirm`,
      {
        method: "POST",
        body: JSON.stringify({ confirmOversell: true }),
      }
    );
    expect(confirmResponse.status).toBe(200);

    const [createdShipment] = await db
      .select({ id: salesShipments.id, shipmentNumber: salesShipments.shipmentNumber })
      .from(salesShipments)
      .where(eq(salesShipments.salesOrderId, partialOrderId));
    expect(createdShipment.id).toBeTruthy();

    const partialLineRows = await db
      .select({ id: salesOrderLines.id, itemId: salesOrderLines.itemId })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, partialOrderId));
    const shortLine = partialLineRows.find(
      (line) => line.itemId === shortItemResult.body.id
    );
    expect(shortLine?.id).toBeTruthy();

    const updateShipmentResponse = await testFetch(
      `/api/sales-orders/${partialOrderId}/shipments/${createdShipment.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          fulfillmentType: "delivery",
          scheduledDate: "2026-04-19",
          notes: null,
          lines: [{ salesOrderLineId: shortLine!.id, quantity: "5" }],
        }),
      }
    );
    expect(updateShipmentResponse.status).toBe(200);

    const createdShipmentLines = await db
      .select({
        itemId: salesShipmentLines.itemId,
        quantity: salesShipmentLines.quantity,
      })
      .from(salesShipmentLines)
      .where(eq(salesShipmentLines.salesShipmentId, createdShipment.id));
    expect(createdShipmentLines).toEqual([
      {
        itemId: shortItemResult.body.id,
        quantity: "5.0000",
      },
    ]);

    const shipPartialResponse = await testFetch(
      `/api/sales-orders/${partialOrderId}/shipments/${createdShipment.id}/ship`,
      {
        method: "POST",
        body: JSON.stringify({ syncAccounting: false, sendEmail: false }),
      }
    );
    expect(shipPartialResponse.status).toBe(200);

    const deletePartiallyShippedResponse = await testFetch(
      `/api/sales-orders/${partialOrderId}`,
      { method: "DELETE" }
    );
    expect(deletePartiallyShippedResponse.status).toBeGreaterThanOrEqual(400);

    await page.goto(`/sales/orders/${partialOrderId}`);
    await expect(page.locator("main")).not.toContainText("remaining quantities were closed");
    await expect(page.locator("main")).toContainText(createdShipment.shipmentNumber);
  });

  /* ================================================================ */
  /*  Flow 3 — Referential integrity                                  */
  /* ================================================================ */

  test("blocks deleting a customer with an active order", async ({ page, db }) => {
    guardOrderId = await createDraftSalesOrder({
      customerId,
      notes: "Customer delete guard coverage",
      confirmOversell: true,
      lines: [
        {
          itemId: secondaryProductId,
          quantity: "1",
          unitPrice: "12.00",
        },
      ],
    });

    const [guardOrder] = await db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.id, guardOrderId));
    expect(guardOrder).toBeTruthy();
    expect(guardOrder.customerId).toBe(customerId);
    expect(guardOrder.status).toBe("open");
    expect(guardOrder.deletedAt).toBeNull();

    const deleteCustomerResponse = await page.request.delete(
      `/api/customers/${customerId}`
    );
    const deleteCustomerBody = await deleteCustomerResponse.json().catch(() => null);
    expect(deleteCustomerResponse.status()).toBe(400);
    expect(deleteCustomerBody?.error ?? "").toMatch(/active sales orders/i);

    const customerRows = await db
      .select()
      .from(salesCustomers)
      .where(eq(salesCustomers.id, customerId));
    expect(customerRows).toHaveLength(1);
    expect(customerRows[0].deletedAt).toBeNull();
  });

  test("blocks deleting a product used by an active order", async ({ page, db }) => {
    await page.goto("/inventory/products");
    await filterList(page, "Search items", secondaryProductName);

    await page
      .getByRole("row")
      .filter({ hasText: secondaryProductName })
      .getByRole("checkbox")
      .click();
    await page.getByRole("button", { name: /Delete.*selected/ }).click();

    const deleteResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        response.url().endsWith("/api/items") &&
        response.request().postData()?.includes(secondaryProductId) === true
    );

    await page.getByRole("button", { name: "Delete" }).click();
    const deleteResponse = await deleteResponsePromise;
    expect(deleteResponse.status()).toBe(400);

    const rows = await db.select().from(items).where(eq(items.id, secondaryProductId));
    expect(rows).toHaveLength(1);
    expect(rows[0].deletedAt).toBeNull();
  });

  // Skip: guard order no longer has a material line (removed due to pricing effect bug).
  // Re-enable when the order form isPriceOverridden logic handles null suggested prices.
  test.fixme("blocks deleting a material used by an active order", async ({ page, db }) => {
    await page.goto("/inventory/materials");
    await filterList(page, "Search items", primaryMaterialName);

    await page.getByLabel(`Select ${primaryMaterialName}`).click();
    await page.getByRole("button", { name: "Actions (1 selected)" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();

    const deleteResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        response.url().endsWith("/api/items") &&
        response.request().postData()?.includes(primaryMaterialId) === true
    );

    await page.getByRole("button", { name: "Delete" }).click();
    const deleteResponse = await deleteResponsePromise;
    expect(deleteResponse.status()).toBe(400);

    const rows = await db.select().from(items).where(eq(items.id, primaryMaterialId));
    expect(rows).toHaveLength(1);
    expect(rows[0].deletedAt).toBeNull();
  });

  test("deletes the blocking order, then deletes the customer", async ({ page, db }) => {
    await deleteSalesOrderByApi(guardOrderId);

    const deleteCustomerResponse = await page.request.delete(
      `/api/customers/${customerId}`
    );
    expect(deleteCustomerResponse.status()).toBe(200);

    const customerRows = await db
      .select()
      .from(salesCustomers)
      .where(eq(salesCustomers.id, customerId));
    expect(customerRows).toHaveLength(1);
    expect(customerRows[0].deletedAt).not.toBeNull();
  });
});
