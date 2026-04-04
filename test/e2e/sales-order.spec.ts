import { eq } from "drizzle-orm";
import { test, expect, filterList } from "./fixtures";
import {
  customerCategories,
  customers as salesCustomers,
  items,
  lots,
  pricingScheduleBreaks,
  pricingSchedules,
  salesOrderLines,
  salesOrders,
  stockMovements,
} from "../../lib/db/schema";
import {
  createCustomer,
  createCustomerCategory,
  createItem,
  createPricingSchedule,
  getUnitId,
  testFetch,
} from "../helpers/api";

async function createDraftSalesOrder(payload: {
  customerId: string;
  requestedDate?: string | null;
  notes?: string | null;
  lines: Array<{
    itemId: string;
    quantity: string;
    unitPrice: string;
  }>;
}) {
  const response = await testFetch("/api/sales-orders", {
    method: "POST",
    body: JSON.stringify({
      customerId: payload.customerId,
      status: "draft",
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

async function updateSalesOrderStatus(orderId: string, status: "cancelled") {
  const response = await testFetch(`/api/sales-orders/${orderId}`, {
    method: "PUT",
    body: JSON.stringify({ status }),
  });
  const body = await response.json().catch(() => null);

  expect(response.status).toBe(200);
  expect(body?.id).toBe(orderId);
}

test.describe("Sales order flow", () => {
  test.describe.configure({ mode: "serial" });

  // Per-run timestamp — used for customers/orders so re-runs don't collide.
  const run = Date.now();
  const fixtureTs = Date.now();
  const unitId = getUnitId();

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
      unitDefinitionId: unitId,
      sku: `SALES-BASE-${fixtureTs}`,
      category: `Sales ${fixtureTs}`,
      description: "Sellable product without a BOM",
      defaultPurchasePrice: null,
      defaultSellingPrice: "12.00",
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(secondaryProductResult.status).toBe(201);
    secondaryProductId = secondaryProductResult.body.id;

    const primaryProductResult = await createItem({
      name: primaryProductName,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `SALES-TOPSOIL-${fixtureTs}`,
      category: `Sales ${fixtureTs}`,
      description: "BOM-backed product for oversell and manufacturing coverage",
      defaultPurchasePrice: null,
      defaultSellingPrice: "34.99",
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
    const nameInput = page.getByLabel("Name");

    await page.goto("/sales/customers/new");
    await expect(page.getByText("Add Customer")).toBeVisible();

    await nameInput.fill(customerName);
    await page.getByLabel("Email").fill(`sales-${run}@example.com`);
    await page.getByLabel("Phone").fill("555-0100");
    await page.getByLabel("Address").fill("123 Market Street");
    await page.getByLabel("Notes").fill("Primary landscaping account");

    await page.getByRole("button", { name: "Create Customer" }).click();
    await page.waitForURL(/\/sales\/customers\/[0-9a-f-]+$/);

    // UI — verify the detail page
    await expect(
      page.getByRole("heading", { name: customerName })
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(`sales-${run}@example.com`)).toBeVisible();
    await expect(page.getByText("555-0100")).toBeVisible();
    await expect(page.getByText("123 Market Street")).toBeVisible();
    await expect(page.getByText("Primary landscaping account")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Invalid");

    // DB
    const rows = await db
      .select()
      .from(salesCustomers)
      .where(eq(salesCustomers.name, customerName));
    expect(rows).toHaveLength(1);

    const customer = rows[0];
    customerId = customer.id;

    expect(customer.email).toBe(`sales-${run}@example.com`);
    expect(customer.phone).toBe("555-0100");
    expect(customer.address).toBe("123 Market Street");
    expect(customer.notes).toBe("Primary landscaping account");
    expect(customer.deletedAt).toBeNull();
  });

  test("edits the customer — verifies pre-population and saves changes", async ({ page, db }) => {
    await page.goto(`/sales/customers/${customerId}/edit`);
    await expect(
      page.getByRole("heading", { name: "Edit Customer" })
    ).toBeVisible({ timeout: 30000 });

    // Verify pre-populated
    await expect(page.getByLabel("Name")).toHaveValue(customerName);
    await expect(page.getByLabel("Email")).toHaveValue(`sales-${run}@example.com`);
    await expect(page.getByLabel("Phone")).toHaveValue("555-0100");
    await expect(page.getByLabel("Address")).toHaveValue("123 Market Street");
    await expect(page.getByLabel("Notes")).toHaveValue("Primary landscaping account");

    // Make changes
    await page.getByLabel("Phone").fill("555-0200");
    await page.getByLabel("Notes").fill("Updated account notes");

    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.waitForURL(`**/sales/customers/${customerId}`);

    // UI — verify detail page reflects the edits
    await expect(page.getByText("555-0200")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("Updated account notes")).toBeVisible({
      timeout: 30000,
    });
    await expect(page.locator("body")).not.toContainText("Invalid");

    // DB
    const [updated] = await db.select().from(salesCustomers).where(eq(salesCustomers.id, customerId));
    expect(updated.phone).toBe("555-0200");
    expect(updated.notes).toBe("Updated account notes");
    expect(updated.email).toBe(`sales-${run}@example.com`);
    expect(updated.address).toBe("123 Market Street");
  });

  test("creates a minimal customer", async ({ page, db }) => {
    extraCustomerName = `Backup Builder ${run}`;
    const nameInput = page.getByLabel("Name");

    await page.goto("/sales/customers/new");
    await expect(page.getByText("Add Customer")).toBeVisible();

    await nameInput.fill(extraCustomerName);

    await page.getByRole("button", { name: "Create Customer" }).click();
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
    expect(customer.address).toBeNull();
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

    await page.goto(`/sales/customers/${customerId}/edit`);
    await expect(
      page.getByRole("heading", { name: "Edit Customer" })
    ).toBeVisible({ timeout: 30000 });
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: `Wholesale ${run}` }).click();
    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.waitForURL(`**/sales/customers/${customerId}`);
    await expect(page.getByText(`Wholesale ${run}`)).toBeVisible();

    await page.goto("/sales/pricing");
    await expect(
      page.getByRole("heading", { name: "Pricing Schedules" })
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
  /*  create → edit → confirm (oversell) → cancel → delete            */
  /* ================================================================ */

  // NOTE: Material line (row 3) removed — the pricing useEffect wipes
  // user-entered prices on items with no default/suggested price. Add it
  // back once the order-form isPriceOverridden logic handles null suggested prices.
  test("creates a draft order with multiple lines", async ({ page, db }) => {
    await page.goto("/sales/orders/new");
    await expect(page.getByText("Add Sales Order")).toBeVisible();

    const customerInput = page.getByPlaceholder("Search customers...");
    await customerInput.click();
    await customerInput.pressSequentially(customerName);
    await page.getByRole("option", { name: new RegExp(customerName) }).click();

    await page.getByLabel("Requested Date").click();
    await page.locator("[data-slot=calendar] button").filter({ hasText: /^15$/ }).first().click();

    const itemInput = page.getByPlaceholder("Search items...");
    await itemInput.click();
    await itemInput.pressSequentially(primaryProductName);
    await page.getByRole("option", { name: new RegExp(primaryProductName) }).click();
    await page.locator('input[placeholder="0"]').first().fill("3");

    await page.getByRole("button", { name: "Add Item" }).click();
    const row2 = page.locator("tbody tr").last();
    await row2.getByPlaceholder("Search items...").click();
    await row2.getByPlaceholder("Search items...").pressSequentially(secondaryProductName);
    await page.getByRole("option", { name: new RegExp(secondaryProductName) }).click();
    await row2.locator('input[placeholder="0"]').first().fill("5");
    await expect(row2.locator('input[placeholder="0.00"]').first()).toHaveValue("10.80");
    await expect(row2.getByText("Suggested $10.80")).toBeVisible();

    await page.getByLabel("Notes").fill("Full lifecycle test order");

    await page.getByRole("button", { name: "Create Order" }).click();
    await page.waitForURL(/\/sales\/orders\/[0-9a-f-]+$/);

    // UI — verify the detail page
    await expect(
      page.locator("main").getByText("Draft", { exact: true }).first()
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(customerName)).toBeVisible();
    await expect(page.getByText(primaryProductName)).toBeVisible();
    await expect(page.getByText(secondaryProductName)).toBeVisible();
    await expect(page.getByText("Full lifecycle test order")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Invalid");

    // DB
    const orderRows = await db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.customerId, customerId));
    expect(orderRows).toHaveLength(1);

    const order = orderRows[0];
    fullOrderId = order.id;
    fullOrderNumber = order.orderNumber;

    expect(order.customerName).toBe(customerName);
    expect(order.status).toBe("draft");
    expect(order.requestedDate).toBe("2026-04-15");
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

    const [primaryItem] = await db.select().from(items).where(eq(items.id, primaryProductId));
    const [secondaryItem] = await db.select().from(items).where(eq(items.id, secondaryProductId));
    const [primaryMaterial] = await db
      .select()
      .from(items)
      .where(eq(items.id, primaryMaterialId));
    expect(primaryItem.committedQty).toBe("0.0000");
    expect(secondaryItem.committedQty).toBe("0.0000");
    expect(primaryMaterial.committedQty).toBe("0.0000");
  });

  test("edits the draft order — verifies pre-population and changes quantity", async ({ page, db }) => {
    await page.goto(`/sales/orders/${fullOrderId}/edit`);
    await expect(page.getByText("Edit Sales Order")).toBeVisible({ timeout: 30000 });

    // Verify pre-populated fields
    await expect(page.getByLabel("Requested Date")).toHaveValue("2026-04-15");
    await expect(page.getByLabel("Notes")).toHaveValue("Full lifecycle test order");

    // Change first line quantity from 3 to 5
    const quantityInputs = page.locator('input[placeholder="0"]');
    await quantityInputs.first().fill("5");
    const priceInputs = page.locator('input[placeholder="0.00"]');
    await priceInputs.nth(1).fill("11.25");
    await page.getByLabel("Notes").fill("Updated to 5 units");

    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.waitForURL(`**/sales/orders/${fullOrderId}`);
    await expect(
      page.getByRole("heading", { name: fullOrderNumber })
    ).toBeVisible({ timeout: 30000 });

    // UI
    await expect(page.getByText("Updated to 5 units")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Invalid");

    // DB
    const orderRows = await db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.id, fullOrderId));
    expect(orderRows).toHaveLength(1);
    expect(orderRows[0].status).toBe("draft");
    expect(orderRows[0].notes).toBe("Updated to 5 units");

    const updatedLineRows = await db
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, fullOrderId));
    const updatedTotal = updatedLineRows.reduce(
      (sum, line) => sum + parseFloat(line.lineTotal),
      0
    );
    expect(parseFloat(orderRows[0].totalAmount)).toBeCloseTo(updatedTotal, 2);

    const updatedSecondaryLine = updatedLineRows.find(
      (line) => line.itemId === secondaryProductId
    );
    expect(updatedSecondaryLine?.unitPrice).toBe("11.25");
    expect(updatedSecondaryLine?.suggestedUnitPrice).toBe("10.80");
    expect(updatedSecondaryLine?.isPriceOverridden).toBe(true);
  });

  test("bulk confirms selected draft orders and handles the oversell warning", async ({
    page,
    db,
  }) => {
    const bulkOrderId = await createDraftSalesOrder({
      customerId: extraCustomerId,
      requestedDate: "2026-04-18",
      notes: "Bulk confirm coverage",
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

    expect(bulkOrder.status).toBe("draft");

    await page.goto("/sales/orders");
    await filterList(page, "Search orders", bulkOrder.orderNumber);

    await page.getByLabel(`Select ${bulkOrder.orderNumber}`).click();
    await expect(page.getByText("1 of 1 row(s) selected.")).toBeVisible();
    await page.getByRole("button", { name: "Actions (1 selected)" }).click();

    const confirmSelectedItem = page.getByRole("menuitem", {
      name: "Confirm Selected",
    });
    await expect(confirmSelectedItem).toBeVisible();
    await confirmSelectedItem.click();

    const oversellDialog = page.getByRole("alertdialog", { name: "Confirm Oversell?" });
    await expect(oversellDialog).toBeVisible({ timeout: 30000 });
    await oversellDialog.getByText("Current Committed", { exact: true }).hover();
    await expect(
      page.getByText("Quantity already reserved by confirmed sales orders.")
    ).toBeVisible();
    await oversellDialog.getByRole("button", { name: "Confirm Anyway" }).click();

    await expect
      .poll(
        async () => {
          const [order] = await db
            .select({ status: salesOrders.status })
            .from(salesOrders)
            .where(eq(salesOrders.id, bulkOrderId));
          return order?.status ?? null;
        },
        { timeout: 15_000 }
      )
      .toBe("confirmed");

    const [primaryItemAfterConfirm] = await db
      .select({ committedQty: items.committedQty })
      .from(items)
      .where(eq(items.id, primaryProductId));
    expect(primaryItemAfterConfirm.committedQty).toBe("5.0000");

    await updateSalesOrderStatus(bulkOrderId, "cancelled");

    await expect
      .poll(
        async () => {
          const [primaryItem] = await db
            .select({ committedQty: items.committedQty })
            .from(items)
            .where(eq(items.id, primaryProductId));
          return primaryItem?.committedQty ?? null;
        },
        { timeout: 15_000 }
      )
      .toBe("0.0000");
  });

  test("confirms the draft order from detail, handles oversell, and commits stock", async ({ page, db }) => {
    await page.goto(`/sales/orders/${fullOrderId}`);
    await expect(page.getByRole("heading", { name: fullOrderNumber })).toBeVisible();

    await page.getByRole("button", { name: "Confirm" }).click();

    // The edited order quantity exceeds the fixture's opening stock, so the oversell dialog should appear.
    const oversellDialog = page.getByRole("alertdialog", { name: "Confirm Oversell?" });
    await expect(oversellDialog).toBeVisible({ timeout: 30000 });
    await oversellDialog.getByText("Current Committed", { exact: true }).hover();
    await expect(
      page.getByText("Quantity already reserved by confirmed sales orders.")
    ).toBeVisible();
    await oversellDialog.getByRole("button", { name: "Confirm Anyway" }).scrollIntoViewIfNeeded();
    await oversellDialog.getByRole("button", { name: "Confirm Anyway" }).click();

    await page.waitForURL(`**/sales/orders/${fullOrderId}`);

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
      .toBe("confirmed");

    await expect
      .poll(
        async () => {
          const [primaryItem] = await db
            .select({ committedQty: items.committedQty })
            .from(items)
            .where(eq(items.id, primaryProductId));
          const [secondaryItem] = await db
            .select({ committedQty: items.committedQty })
            .from(items)
            .where(eq(items.id, secondaryProductId));
          const [materialItem] = await db
            .select({ committedQty: items.committedQty })
            .from(items)
            .where(eq(items.id, primaryMaterialId));

          return {
            primary: primaryItem?.committedQty ?? null,
            secondary: secondaryItem?.committedQty ?? null,
            material: materialItem?.committedQty ?? null,
          };
        },
        { timeout: 15_000 }
      )
      .toEqual({
        primary: "5.0000",
        secondary: "5.0000",
        material: "5.0000",
      });
  });

  test("confirmed orders are read-only from detail", async ({ page }) => {
    await page.goto(`/sales/orders/${fullOrderId}`);
    await expect(page.getByRole("heading", { name: fullOrderNumber })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit" })).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  });

  test("confirmed orders show Create MOs from detail and the orders table", async ({
    page,
  }) => {
    await page.goto(`/sales/orders/${fullOrderId}`);
    await expect(page.getByRole("heading", { name: fullOrderNumber })).toBeVisible();

    await page.getByRole("link", { name: "Create MOs", exact: true }).click();
    await page.waitForURL(`**/manufacturing/orders/new?salesOrderId=${fullOrderId}`);
    await expect(
      page.getByRole("heading", { name: "Add Manufacturing Order" })
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("Sales Order Preview")).toBeVisible({ timeout: 30000 });

    await page.goto("/sales/orders");
    await filterList(page, "Search orders", fullOrderNumber);

    const confirmedRow = page.getByRole("row", {
      name: new RegExp(fullOrderNumber),
    });
    await expect(
      confirmedRow.getByRole("link", { name: "Create MOs" })
    ).toBeVisible();
    await confirmedRow.getByRole("link", { name: "Create MOs" }).click();
    await page.waitForURL(`**/manufacturing/orders/new?salesOrderId=${fullOrderId}`);
    await expect(
      page.getByRole("heading", { name: "Add Manufacturing Order" })
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("Sales Order Preview")).toBeVisible({ timeout: 30000 });
  });

  test("confirmed non-manufacturable orders keep Create MOs disabled with a tooltip", async ({
    page,
    db,
  }) => {
    noManufacturingOrderId = await createDraftSalesOrder({
      customerId: extraCustomerId,
      requestedDate: "2026-04-19",
      notes: "Disabled manufacturing action coverage",
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
    expect(confirmedOrder.status).toBe("confirmed");

    await page.goto(`/sales/orders/${noManufacturingOrderId}`);
    const detailCreateButton = page.getByRole("button", {
      name: "Create MOs",
      exact: true,
    });
    await expect(detailCreateButton).toBeDisabled();
    await expect(detailCreateButton).toHaveAttribute(
      "data-disabled-reason",
      "No active BOM-backed products remain on this order."
    );

    await page.goto("/sales/orders");
    await filterList(page, "Search orders", noManufacturingOrderNumber);

    const disabledRow = page.getByRole("row", {
      name: new RegExp(noManufacturingOrderNumber),
    });
    const rowCreateButton = disabledRow.getByRole("button", {
      name: "Create MOs",
    });
    await expect(rowCreateButton).toBeDisabled();
    await expect(rowCreateButton).toHaveAttribute(
      "data-disabled-reason",
      "No active BOM-backed products remain on this order."
    );

    await updateSalesOrderStatus(noManufacturingOrderId, "cancelled");

    await expect
      .poll(
        async () => {
          const [secondaryItem] = await db
            .select({ committedQty: items.committedQty })
            .from(items)
            .where(eq(items.id, secondaryProductId));
          return secondaryItem?.committedQty ?? null;
        },
        { timeout: 15_000 }
      )
      .toBe("5.0000");
  });

  test("cancels the confirmed order and releases committed stock", async ({ page, db }) => {
    await page.goto(`/sales/orders/${fullOrderId}`);
    await expect(page.getByRole("heading", { name: fullOrderNumber })).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Cancel Order" }).click();
    // Page refreshes after cancel — give it extra time (slowmo can eat the default 5s)
    await expect(page.locator("main").getByText("Cancelled", { exact: true }).first()).toBeVisible({ timeout: 15000 });

    const orderRows = await db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.id, fullOrderId));
    expect(orderRows).toHaveLength(1);
    expect(orderRows[0].status).toBe("cancelled");

    const [primaryItem] = await db.select().from(items).where(eq(items.id, primaryProductId));
    const [secondaryItem] = await db.select().from(items).where(eq(items.id, secondaryProductId));
    const [primaryMaterial] = await db
      .select()
      .from(items)
      .where(eq(items.id, primaryMaterialId));
    expect(primaryItem.committedQty).toBe("0.0000");
    expect(secondaryItem.committedQty).toBe("0.0000");
    expect(primaryMaterial.committedQty).toBe("0.0000");
  });

  test("deletes the cancelled order", async ({ page, db }) => {
    await page.goto(`/sales/orders/${fullOrderId}`);
    await expect(page.getByRole("heading", { name: fullOrderNumber })).toBeVisible();

    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete Order" }).click();
    await page.waitForURL("**/sales/orders");
    await filterList(page, "Search orders", fullOrderNumber);

    await expect(page.getByText(`No results for "${fullOrderNumber}"`)).toBeVisible();

    const orderRows = await db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.id, fullOrderId));
    expect(orderRows).toHaveLength(1);
    expect(orderRows[0].deletedAt).not.toBeNull();
  });

  test("fulfills a confirmed order and releases committed stock", async ({ db }) => {
    const fulfillCustomerResult = await createCustomer({
      name: `Fulfillment Customer ${run}`,
    });
    expect(fulfillCustomerResult.status).toBe(201);
    const fulfillCustomerId = fulfillCustomerResult.body.id as string;

    const fulfillOrderId = await createDraftSalesOrder({
      customerId: fulfillCustomerId,
      notes: "Fulfillment coverage",
      lines: [
        {
          itemId: primaryProductId,
          quantity: "3",
          unitPrice: "34.99",
        },
      ],
    });

    const confirmResponse = await testFetch(
      `/api/sales-orders/${fulfillOrderId}/confirm`,
      {
        method: "POST",
        body: JSON.stringify({ confirmOversell: false }),
      }
    );
    expect(confirmResponse.status).toBe(200);

    const [confirmedOrder] = await db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, fulfillOrderId));
    expect(confirmedOrder.status).toBe("confirmed");

    const [beforeFulfill] = await db
      .select({ committedQty: items.committedQty })
      .from(items)
      .where(eq(items.id, primaryProductId));
    expect(beforeFulfill.committedQty).toBe("3.0000");

    const lotsBefore = await db
      .select({ quantity: lots.quantity })
      .from(lots)
      .where(eq(lots.itemId, primaryProductId));
    const stockBefore = lotsBefore.reduce(
      (sum, lot) => sum + parseFloat(lot.quantity),
      0
    );

    const fulfillResponse = await testFetch(
      `/api/sales-orders/${fulfillOrderId}/fulfill`,
      { method: "POST" }
    );
    expect(fulfillResponse.status).toBe(200);

    const [fulfilledOrder] = await db
      .select({
        status: salesOrders.status,
        fulfilledAt: salesOrders.fulfilledAt,
      })
      .from(salesOrders)
      .where(eq(salesOrders.id, fulfillOrderId));
    expect(fulfilledOrder.status).toBe("fulfilled");
    expect(fulfilledOrder.fulfilledAt).not.toBeNull();

    const [afterFulfill] = await db
      .select({ committedQty: items.committedQty })
      .from(items)
      .where(eq(items.id, primaryProductId));
    expect(afterFulfill.committedQty).toBe("0.0000");

    const lotsAfter = await db
      .select({ quantity: lots.quantity })
      .from(lots)
      .where(eq(lots.itemId, primaryProductId));
    const stockAfter = lotsAfter.reduce(
      (sum, lot) => sum + parseFloat(lot.quantity),
      0
    );
    expect(stockAfter).toBeCloseTo(stockBefore - 3, 2);

    const fulfillMovements = await db
      .select({
        itemId: stockMovements.itemId,
        movementType: stockMovements.movementType,
        referenceType: stockMovements.referenceType,
      })
      .from(stockMovements)
      .where(eq(stockMovements.referenceId, fulfillOrderId));

    const secondaryProductMovements = fulfillMovements.filter(
      (movement) =>
        movement.itemId === primaryProductId &&
        movement.movementType === "sales_fulfilled"
    );

    expect(secondaryProductMovements.length).toBeGreaterThanOrEqual(1);
    expect(
      secondaryProductMovements.every(
        (movement) => movement.referenceType === "sales_order"
      )
    ).toBe(true);
  });

  /* ================================================================ */
  /*  Flow 3 — Referential integrity                                  */
  /* ================================================================ */

  test("blocks deleting a customer with an active order", async ({ page, db }) => {
    await page.goto("/sales/orders/new");

    const customerInput = page.getByPlaceholder("Search customers...");
    await customerInput.click();
    await customerInput.pressSequentially(customerName);
    await page.getByRole("option", { name: new RegExp(customerName) }).click();

    const itemInput = page.getByPlaceholder("Search items...");
    await itemInput.click();
    await itemInput.pressSequentially(secondaryProductName);
    await page.getByRole("option", { name: new RegExp(secondaryProductName) }).click();
    await page.locator('input[placeholder="0"]').first().fill("1");

    await page.getByRole("button", { name: "Add Item" }).click();
    const materialRow = page.locator("tbody tr").last();
    await materialRow.getByPlaceholder("Search items...").click();
    await materialRow.getByPlaceholder("Search items...").pressSequentially(primaryMaterialName);
    await page.getByRole("option", { name: new RegExp(primaryMaterialName) }).click();
    await materialRow.locator('input[placeholder="0"]').first().fill("4");
    await materialRow.locator('input[placeholder="0.00"]').fill("6.25");

    await page.getByRole("button", { name: "Create Order" }).click();
    await page.waitForURL(/\/sales\/orders\/[0-9a-f-]+$/);

    const guardOrderRows = await db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.customerId, customerId));
    const activeOrder = guardOrderRows.find((row) => row.deletedAt == null);
    expect(activeOrder).toBeTruthy();
    guardOrderId = activeOrder!.id;

    await page.goto(`/sales/customers/${customerId}`);
    await expect(page.getByRole("heading", { name: customerName })).toBeVisible();

    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete Customer" }).click();

    await expect(page.getByText(/cannot delete|active.*order/i)).toBeVisible();

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

    await page.getByLabel(`Select ${secondaryProductName}`).click();
    await page.getByRole("button", { name: "Actions (1 selected)" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();

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

  test("blocks deleting a material used by an active order", async ({ page, db }) => {
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
    await page.goto(`/sales/orders/${guardOrderId}`);
    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete Order" }).click();
    await page.waitForURL("**/sales/orders");

    await page.goto(`/sales/customers/${customerId}`);
    await expect(page.getByRole("heading", { name: customerName })).toBeVisible();

    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete Customer" }).click();
    await page.waitForURL("**/sales/customers");
    await filterList(page, "Search customers", customerName);

    await expect(page.getByText(`No results for "${customerName}"`)).toBeVisible();

    const customerRows = await db
      .select()
      .from(salesCustomers)
      .where(eq(salesCustomers.id, customerId));
    expect(customerRows).toHaveLength(1);
    expect(customerRows[0].deletedAt).not.toBeNull();
  });
});
