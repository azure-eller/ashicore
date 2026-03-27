import fs from "node:fs";
import type { Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { test, expect } from "./fixtures";
import {
  customers as salesCustomers,
  items,
  lots,
  salesOrderLines,
  salesOrders,
  stockMovements,
} from "../../lib/db/schema";

const env = JSON.parse(fs.readFileSync("test/.test-env.json", "utf-8"));
const SESSION_COOKIE = env.TEST_SESSION_COOKIE;

function parseCookie(raw: string) {
  const [name, ...rest] = raw.split("=");
  return { name, value: rest.join("=") };
}

async function filterList(page: Page, label: string, value: string) {
  const input = page.getByLabel(label);
  await input.fill(value);
  await expect(input).toHaveValue(value);
}

test.beforeEach(async ({ context }) => {
  const { name, value } = parseCookie(SESSION_COOKIE);
  await context.addCookies([
    { name, value, domain: "localhost", path: "/" },
  ]);
});

test.describe("Sales order flow", () => {
  test.describe.configure({ mode: "serial" });

  // Per-run timestamp — sales creates its own data so the file can run in isolation.
  const run = Date.now();

  let primaryProductName: string;
  let secondaryProductName: string;
  let primaryProductId: string;
  let secondaryProductId: string;
  let fulfillableProductId: string;
  let fulfillableProductName: string;
  let fulfillableLotId: string;

  let customerId: string;
  let customerName: string;
  let extraCustomerId: string;
  let extraCustomerName: string;

  let fullOrderId: string;
  let fullOrderNumber: string;
  let fulfillableOrderId: string;
  let fulfillableOrderNumber: string;
  let guardOrderId: string;

  test("creates products for the sales order flows", async ({ page, db }) => {
    primaryProductName = `Premium Topsoil ${run}`;
    secondaryProductName = `Base Mix ${run}`;

    await page.goto("/inventory/products/new");
    await expect(page.getByText("Add Product")).toBeVisible();

    await page.getByLabel("Name").fill(primaryProductName);
    await page.locator("#unitDefinitionId").click();
    await page.getByRole("option").first().click();
    await page.getByLabel("Selling Price").fill("34.99");
    await page.getByLabel("Safety Stock").fill("0");

    await page.getByRole("button", { name: "Create Product" }).click();
    await page.waitForURL(/\/inventory\/products\/[0-9a-f-]+$/);

    const [primary] = await db.select().from(items).where(eq(items.name, primaryProductName));
    expect(primary).toBeTruthy();
    primaryProductId = primary.id;
    expect(primary.defaultSellingPrice).toBe("34.99");

    const primaryLotRows = await db.select().from(lots).where(eq(lots.itemId, primary.id));
    expect(primaryLotRows).toHaveLength(0);

    await page.goto("/inventory/products/new");
    await expect(page.getByText("Add Product")).toBeVisible();

    await page.getByLabel("Name").fill(secondaryProductName);
    await page.locator("#unitDefinitionId").click();
    await page.getByRole("option").first().click();
    await page.getByLabel("Selling Price").fill("12.00");
    await page.getByLabel("Stock", { exact: true }).fill("50");
    await page.getByLabel("Safety Stock").fill("10");

    await page.getByRole("button", { name: "Create Product" }).click();
    await page.waitForURL(/\/inventory\/products\/[0-9a-f-]+$/);

    const [secondary] = await db.select().from(items).where(eq(items.name, secondaryProductName));
    expect(secondary).toBeTruthy();
    secondaryProductId = secondary.id;
    expect(secondary.defaultSellingPrice).toBe("12.00");

    const secondaryLotRows = await db.select().from(lots).where(eq(lots.itemId, secondary.id));
    expect(secondaryLotRows).toHaveLength(1);
    expect(secondaryLotRows[0].quantity).toBe("50.0000");
  });

  test("creates a stocked product dedicated to fulfillment flows", async ({ page, db }) => {
    fulfillableProductName = `Bagged Loam ${run}`;

    await page.goto("/inventory/products/new");
    await expect(page.getByText("Add Product")).toBeVisible();

    await page.getByLabel("Name").fill(fulfillableProductName);
    await page.locator("#unitDefinitionId").click();
    await page.getByRole("option").first().click();
    await page.getByLabel("Selling Price").fill("18.00");
    await page.getByLabel("Stock", { exact: true }).fill("8");
    await page.getByLabel("Safety Stock").fill("0");

    await page.getByRole("button", { name: "Create Product" }).click();
    await page.waitForURL(/\/inventory\/products\/[0-9a-f-]+$/);

    const [product] = await db.select().from(items).where(eq(items.name, fulfillableProductName));
    expect(product).toBeTruthy();
    fulfillableProductId = product.id;
    expect(product.defaultSellingPrice).toBe("18.00");

    const lotRows = await db.select().from(lots).where(eq(lots.itemId, product.id));
    expect(lotRows).toHaveLength(1);
    fulfillableLotId = lotRows[0].id;
    expect(lotRows[0].quantity).toBe("8.0000");
  });

  /* ================================================================ */
  /*  Flow 1 — Customer creation + edit                               */
  /* ================================================================ */

  test("creates a customer with all fields", async ({ page, db }) => {
    customerName = `Acme Landscaping ${run}`;

    await page.goto("/sales/customers/new");
    await expect(page.getByText("Add Customer")).toBeVisible();

    await page.locator("#email").fill(`sales-${run}@example.com`);
    await page.locator("#phone").fill("555-0100");
    await page.locator("#address").fill("123 Market Street");
    await page.locator("#notes").fill("Primary landscaping account");
    await page.locator("#name").click();
    await page.locator("#name").pressSequentially(customerName, { delay: 20 });
    await expect(page.locator("#name")).toHaveValue(customerName);
    await page.locator("#name").blur();

    await page.getByRole("button", { name: "Create Customer" }).click();
    await page.waitForURL(/\/sales\/customers\/[0-9a-f-]+$/);

    // UI — verify the detail page
    await expect(page.getByRole("heading", { name: customerName })).toBeVisible();
    await expect(page.getByText(`sales-${run}@example.com`)).toBeVisible();
    await expect(page.getByText("555-0100")).toBeVisible();
    await expect(page.getByText("123 Market Street")).toBeVisible();
    await expect(page.getByText("Primary landscaping account")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Invalid");

    // UI — verify the list page
    await page.goto("/sales/customers");
    await filterList(page, "Search customers", customerName);
    const fullRow = page.getByRole("row", { name: new RegExp(customerName) }).first();
    await expect(fullRow).toBeVisible();
    await expect(fullRow).toContainText(`sales-${run}@example.com`);
    await expect(fullRow).toContainText("555-0100");
    await expect(fullRow).not.toContainText("Invalid");

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
    await page.goto(`/sales/customers/${customerId}`);
    await page.getByRole("link", { name: "Edit" }).click();
    await expect(page.getByText("Edit Customer")).toBeVisible();

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
    await expect(page.getByText("555-0200")).toBeVisible();
    await expect(page.getByText("Updated account notes")).toBeVisible();
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

    await page.goto("/sales/customers/new");
    await expect(page.getByText("Add Customer")).toBeVisible();

    await page.locator("#name").click();
    await page.locator("#name").pressSequentially(extraCustomerName, { delay: 20 });
    await expect(page.locator("#name")).toHaveValue(extraCustomerName);
    await page.locator("#name").blur();

    await page.getByRole("button", { name: "Create Customer" }).click();
    await page.waitForURL(/\/sales\/customers\/[0-9a-f-]+$/);

    // UI — verify the detail page
    await expect(page.getByRole("heading", { name: extraCustomerName })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Invalid");

    // UI — verify the list page
    await page.goto("/sales/customers");
    await filterList(page, "Search customers", extraCustomerName);
    const minRow = page.getByRole("row", { name: new RegExp(extraCustomerName) }).first();
    await expect(minRow).toBeVisible();
    await expect(minRow).not.toContainText("Invalid");

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

  /* ================================================================ */
  /*  Flow 2 — Full sales order lifecycle                             */
  /*  create → edit → confirm (oversell) → cancel → delete            */
  /* ================================================================ */

  test("creates a draft order with multiple lines", async ({ page, db }) => {
    await page.goto("/sales/orders/new");
    await expect(page.getByText("Add Sales Order")).toBeVisible();

    const customerInput = page.getByPlaceholder("Search customers...");
    await customerInput.click();
    await customerInput.fill(customerName);
    await page.getByRole("option", { name: new RegExp(customerName) }).click();

    await page.getByLabel("Requested Date").fill("2026-04-15");

    const productInput = page.getByPlaceholder("Search products...");
    await productInput.click();
    await productInput.fill(primaryProductName);
    await page.getByRole("option", { name: new RegExp(primaryProductName) }).click();
    await page.locator('input[placeholder="0"]').first().fill("3");

    await page.getByRole("button", { name: "Add Item" }).click();
    const row2 = page.locator("tbody tr").last();
    await row2.getByPlaceholder("Search products...").click();
    await row2.getByPlaceholder("Search products...").fill(secondaryProductName);
    await page.getByRole("option", { name: new RegExp(secondaryProductName) }).click();
    await row2.locator('input[placeholder="0"]').first().fill("2");

    await page.getByLabel("Notes").fill("Full lifecycle test order");

    await page.getByRole("button", { name: "Create Order" }).click();
    await page.waitForURL(/\/sales\/orders\/[0-9a-f-]+$/);

    // UI — verify the detail page
    await expect(page.locator("main").getByText("Draft", { exact: true }).first()).toBeVisible();
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
    expect(order.totalAmount).toBe("128.97");
    expect(order.deletedAt).toBeNull();

    const lineRows = await db
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.id));
    expect(lineRows).toHaveLength(2);

    const lineByItem = new Map(lineRows.map((line) => [line.itemId, line]));
    expect(lineByItem.get(primaryProductId)?.quantity).toBe("3.0000");
    expect(lineByItem.get(primaryProductId)?.lineTotal).toBe("104.97");
    expect(lineByItem.get(secondaryProductId)?.quantity).toBe("2.0000");
    expect(lineByItem.get(secondaryProductId)?.lineTotal).toBe("24.00");

    const [primaryItem] = await db.select().from(items).where(eq(items.id, primaryProductId));
    const [secondaryItem] = await db.select().from(items).where(eq(items.id, secondaryProductId));
    expect(primaryItem.committedQty).toBe("0.0000");
    expect(secondaryItem.committedQty).toBe("0.0000");
  });

  test("edits the draft order — verifies pre-population and changes quantity", async ({ page, db }) => {
    await page.goto(`/sales/orders/${fullOrderId}/edit`);
    await expect(page.getByText("Edit Sales Order")).toBeVisible();

    // Verify pre-populated fields
    await expect(page.getByLabel("Requested Date")).toHaveValue("2026-04-15");
    await expect(page.getByLabel("Notes")).toHaveValue("Full lifecycle test order");

    // Change first line quantity from 3 to 5
    const quantityInputs = page.locator('input[placeholder="0"]');
    await quantityInputs.first().fill("5");
    await page.getByLabel("Notes").fill("Updated to 5 units");

    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.waitForURL(`**/sales/orders/${fullOrderId}`);
    await expect(page.getByRole("heading", { name: fullOrderNumber })).toBeVisible();

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
    expect(orderRows[0].totalAmount).toBe("198.95");
  });

  test("confirms the draft order — handles oversell dialog — and commits stock", async ({ page, db }) => {
    await page.goto(`/sales/orders/${fullOrderId}/edit`);
    await expect(page.getByText("Edit Sales Order")).toBeVisible();

    await page.getByRole("combobox").filter({ hasText: "Draft" }).first().click();
    await page.getByRole("option", { name: "Confirmed" }).click();
    await page.getByRole("button", { name: "Save Changes" }).click();

    // Premium Topsoil has zero stock, so the oversell dialog should appear
    const oversellDialog = page.getByRole("alertdialog", { name: "Confirm Oversell?" });
    await expect(oversellDialog).toBeVisible();
    await oversellDialog.getByText("Current Committed", { exact: true }).hover();
    await expect(
      page.getByText("Quantity already reserved by confirmed sales orders.")
    ).toBeVisible();
    await oversellDialog.getByRole("button", { name: "Confirm Anyway" }).scrollIntoViewIfNeeded();
    await oversellDialog.getByRole("button", { name: "Confirm Anyway" }).click();

    await page.waitForURL(`**/sales/orders/${fullOrderId}`);

    const orderRows = await db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.id, fullOrderId));
    expect(orderRows).toHaveLength(1);
    expect(orderRows[0].status).toBe("confirmed");

    const [primaryItem] = await db.select().from(items).where(eq(items.id, primaryProductId));
    const [secondaryItem] = await db.select().from(items).where(eq(items.id, secondaryProductId));
    expect(primaryItem.committedQty).toBe("5.0000");
    expect(secondaryItem.committedQty).toBe("2.0000");
  });

  test("confirmed oversold orders stay read-only and block fulfillment on live stock shortage", async ({ page, db }) => {
    await page.goto(`/sales/orders/${fullOrderId}`);
    await expect(page.getByRole("heading", { name: fullOrderNumber })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit" })).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Fulfill" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();

    await page.getByRole("button", { name: "Fulfill" }).click();
    await page.getByRole("button", { name: "Fulfill Order" }).click();

    await expect(
      page.getByText(`Cannot fulfill order. Insufficient stock for ${primaryProductName}.`)
    ).toBeVisible();
    await expect(page.locator("main").getByText("Confirmed", { exact: true }).first()).toBeVisible();

    const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, fullOrderId));
    expect(order.status).toBe("confirmed");
    expect(order.fulfilledAt).toBeNull();

    const [primaryItem] = await db.select().from(items).where(eq(items.id, primaryProductId));
    const [secondaryItem] = await db.select().from(items).where(eq(items.id, secondaryProductId));
    expect(primaryItem.committedQty).toBe("5.0000");
    expect(secondaryItem.committedQty).toBe("2.0000");

    const secondaryLots = await db.select().from(lots).where(eq(lots.itemId, secondaryProductId));
    const secondaryStock = secondaryLots.reduce((sum, lot) => sum + parseFloat(lot.quantity), 0);
    expect(secondaryStock).toBe(50);

    const fulfillmentMovements = await db
      .select()
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.referenceId, fullOrderId),
          eq(stockMovements.referenceType, "sales_order")
        )
      );
    expect(fulfillmentMovements).toHaveLength(0);
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
    expect(primaryItem.committedQty).toBe("0.0000");
    expect(secondaryItem.committedQty).toBe("0.0000");
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

  /* ================================================================ */
  /*  Flow 3 — Successful fulfillment                                 */
  /* ================================================================ */

  test("creates a confirmed stocked order for fulfillment", async ({ page, db }) => {
    await page.goto("/sales/orders/new");
    await expect(page.getByText("Add Sales Order")).toBeVisible();

    const customerInput = page.getByPlaceholder("Search customers...");
    await customerInput.click();
    await customerInput.fill(extraCustomerName);
    await page.getByRole("option", { name: new RegExp(extraCustomerName) }).click();

    const productInput = page.getByPlaceholder("Search products...");
    await productInput.click();
    await productInput.fill(fulfillableProductName);
    await page.getByRole("option", { name: new RegExp(fulfillableProductName) }).click();
    await page.locator('input[placeholder="0"]').first().fill("4");

    await page.getByRole("combobox").filter({ hasText: "Draft" }).first().click();
    await page.getByRole("option", { name: "Confirmed" }).click();
    await page.getByLabel("Notes").fill("Stocked fulfillment order");

    await page.getByRole("button", { name: "Create Order" }).click();
    await page.waitForURL(/\/sales\/orders\/[0-9a-f-]+$/);

    await expect(page.locator("main").getByText("Confirmed", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Fulfill" })).toBeVisible();

    const orderRows = await db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.customerId, extraCustomerId));
    const order = orderRows.find((row) => row.deletedAt == null);
    expect(order).toBeTruthy();

    fulfillableOrderId = order!.id;
    fulfillableOrderNumber = order!.orderNumber;
    expect(order!.status).toBe("confirmed");
    expect(order!.fulfilledAt).toBeNull();

    const [fulfillableItem] = await db.select().from(items).where(eq(items.id, fulfillableProductId));
    expect(fulfillableItem.committedQty).toBe("4.0000");
  });

  test("fulfills the confirmed stocked order, consumes stock, and writes audit movements", async ({ page, db }) => {
    await page.goto(`/sales/orders/${fulfillableOrderId}`);
    await expect(page.getByRole("heading", { name: fulfillableOrderNumber })).toBeVisible();

    await page.getByRole("button", { name: "Fulfill" }).click();
    await page.getByRole("button", { name: "Fulfill Order" }).click();

    await expect(page.locator("main").getByText("Fulfilled", { exact: true }).first()).toBeVisible();

    const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, fulfillableOrderId));
    expect(order.status).toBe("fulfilled");
    expect(order.fulfilledAt).not.toBeNull();

    const [fulfillableItem] = await db.select().from(items).where(eq(items.id, fulfillableProductId));
    expect(fulfillableItem.committedQty).toBe("0.0000");

    const [lot] = await db.select().from(lots).where(eq(lots.id, fulfillableLotId));
    expect(lot.quantity).toBe("4.0000");

    const movements = await db
      .select()
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.referenceId, fulfillableOrderId),
          eq(stockMovements.referenceType, "sales_order")
        )
      );

    expect(movements).toHaveLength(1);
    expect(movements[0].movementType).toBe("sales_fulfilled");
    expect(movements[0].itemId).toBe(fulfillableProductId);
    expect(movements[0].lotId).toBe(fulfillableLotId);
    expect(movements[0].quantity).toBe("-4.0000");
  });

  test("fulfilled orders are read-only from detail", async ({ page }) => {
    await page.goto(`/sales/orders/${fulfillableOrderId}`);
    await expect(page.getByRole("heading", { name: fulfillableOrderNumber })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit" })).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Fulfill" })).not.toBeVisible();
  });

  test("fulfilled orders do not block deleting their customer or product, and snapshots still render", async ({ page, db }) => {
    await page.goto(`/sales/customers/${extraCustomerId}`);
    await expect(page.getByRole("heading", { name: extraCustomerName })).toBeVisible();

    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete Customer" }).click();
    await page.waitForURL("**/sales/customers");
    await filterList(page, "Search customers", extraCustomerName);
    await expect(page.getByText(`No results for "${extraCustomerName}"`)).toBeVisible();

    const [customer] = await db.select().from(salesCustomers).where(eq(salesCustomers.id, extraCustomerId));
    expect(customer.deletedAt).not.toBeNull();

    await page.goto("/inventory/products");
    await filterList(page, "Search items", fulfillableProductName);
    await page.getByLabel(`Select ${fulfillableProductName}`).click();
    await page.getByRole("button", { name: "Actions (1 selected)" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();

    const deleteResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        response.url().endsWith("/api/items") &&
        response.request().postData()?.includes(fulfillableProductId) === true
    );

    await page.getByRole("button", { name: "Delete" }).click();
    const deleteResponse = await deleteResponsePromise;
    expect(deleteResponse.status()).toBe(200);

    const [product] = await db.select().from(items).where(eq(items.id, fulfillableProductId));
    expect(product.deletedAt).not.toBeNull();

    await page.goto(`/sales/orders/${fulfillableOrderId}`);
    await expect(page.getByRole("heading", { name: fulfillableOrderNumber })).toBeVisible();
    await expect(page.getByText(extraCustomerName)).toBeVisible();
    await expect(page.getByText(fulfillableProductName)).toBeVisible();
  });

  test("deletes the fulfilled order without changing stock history", async ({ page, db }) => {
    await page.goto(`/sales/orders/${fulfillableOrderId}`);
    await expect(page.getByRole("heading", { name: fulfillableOrderNumber })).toBeVisible();

    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete Order" }).click();
    await page.waitForURL("**/sales/orders");
    await filterList(page, "Search orders", fulfillableOrderNumber);
    await expect(page.getByText(`No results for "${fulfillableOrderNumber}"`)).toBeVisible();

    const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, fulfillableOrderId));
    expect(order.deletedAt).not.toBeNull();
    expect(order.status).toBe("fulfilled");

    const [lot] = await db.select().from(lots).where(eq(lots.id, fulfillableLotId));
    expect(lot.quantity).toBe("4.0000");

    const movements = await db
      .select()
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.referenceId, fulfillableOrderId),
          eq(stockMovements.referenceType, "sales_order")
        )
      );
    expect(movements).toHaveLength(1);
  });

  /* ================================================================ */
  /*  Flow 4 — Referential integrity                                  */
  /* ================================================================ */

  test("blocks deleting a customer with an active order", async ({ page, db }) => {
    await page.goto("/sales/orders/new");

    const customerInput = page.getByPlaceholder("Search customers...");
    await customerInput.click();
    await customerInput.fill(customerName);
    await page.getByRole("option", { name: new RegExp(customerName) }).click();

    const productInput = page.getByPlaceholder("Search products...");
    await productInput.click();
    await productInput.fill(secondaryProductName);
    await page.getByRole("option", { name: new RegExp(secondaryProductName) }).click();
    await page.locator('input[placeholder="0"]').first().fill("1");

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

  test("deletes the blocking order, then deletes the customer and product", async ({ page, db }) => {
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
    expect(deleteResponse.status()).toBe(200);

    const [product] = await db.select().from(items).where(eq(items.id, secondaryProductId));
    expect(product.deletedAt).not.toBeNull();
  });
});
