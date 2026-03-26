import fs from "node:fs";
import type { Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { test, expect } from "./fixtures";
import {
  customers as salesCustomers,
  items,
  salesOrderLines,
  salesOrders,
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

  const ts = Date.now();

  let primaryProductId: string;
  let primaryProductName: string;
  let secondaryProductId: string;
  let secondaryProductName: string;
  let oversellProductId: string;
  let oversellProductName: string;

  let customerId: string;
  let customerName: string;
  let extraCustomerId: string;
  let extraCustomerName: string;

  let fullOrderId: string;
  let fullOrderNumber: string;
  let oversellOrderId: string;
  let oversellOrderNumber: string;
  let guardOrderId: string;

  test("creates a stocked primary product for sales flows", async ({ page, db }) => {
    primaryProductName = `Topsoil ${ts}`;

    await page.goto("/inventory/products/new");
    await expect(page.getByText("Add Product")).toBeVisible();

    await page.getByLabel("Name").fill(primaryProductName);
    await page.locator("#unitDefinitionId").click();
    await page.getByRole("option").first().click();
    await page.getByLabel("Selling Price").fill("29.99");
    await page.getByLabel("Stock", { exact: true }).fill("50");
    await page.getByLabel("Safety Stock").fill("0");

    await page.getByRole("button", { name: "Create Product" }).click();
    await page.waitForURL("**/inventory/products");

    const rows = await db.select().from(items).where(eq(items.name, primaryProductName));
    expect(rows).toHaveLength(1);

    const product = rows[0];
    primaryProductId = product.id;

    expect(product.itemType).toBe("product");
    expect(product.defaultSellingPrice).toBe("29.99");
    expect(product.committedQty).toBe("0.0000");
  });

  test("creates a stocked secondary product for multi-line orders", async ({ page, db }) => {
    secondaryProductName = `Mulch ${ts}`;

    await page.goto("/inventory/products/new");
    await expect(page.getByText("Add Product")).toBeVisible();

    await page.getByLabel("Name").fill(secondaryProductName);
    await page.locator("#unitDefinitionId").click();
    await page.getByRole("option").first().click();
    await page.getByLabel("Selling Price").fill("12.00");
    await page.getByLabel("Stock", { exact: true }).fill("25");
    await page.getByLabel("Safety Stock").fill("0");

    await page.getByRole("button", { name: "Create Product" }).click();
    await page.waitForURL("**/inventory/products");

    const rows = await db.select().from(items).where(eq(items.name, secondaryProductName));
    expect(rows).toHaveLength(1);

    const product = rows[0];
    secondaryProductId = product.id;

    expect(product.itemType).toBe("product");
    expect(product.defaultSellingPrice).toBe("12.00");
    expect(product.committedQty).toBe("0.0000");
  });

  test("creates a zero-stock product for deterministic oversell coverage", async ({ page, db }) => {
    oversellProductName = `Scarce Mix ${ts}`;

    await page.goto("/inventory/products/new");
    await expect(page.getByText("Add Product")).toBeVisible();

    await page.getByLabel("Name").fill(oversellProductName);
    await page.locator("#unitDefinitionId").click();
    await page.getByRole("option").first().click();
    await page.getByLabel("Selling Price").fill("19.50");
    await page.getByLabel("Safety Stock").fill("0");

    await page.getByRole("button", { name: "Create Product" }).click();
    await page.waitForURL("**/inventory/products");

    const rows = await db.select().from(items).where(eq(items.name, oversellProductName));
    expect(rows).toHaveLength(1);

    const product = rows[0];
    oversellProductId = product.id;

    expect(product.itemType).toBe("product");
    expect(product.defaultSellingPrice).toBe("19.50");
    expect(product.committedQty).toBe("0.0000");
  });

  test("creates a customer with all fields", async ({ page, db }) => {
    customerName = `Acme Landscaping ${ts}`;

    await page.goto("/sales/customers/new");
    await expect(page.getByText("Add Customer")).toBeVisible();

    await page.locator("#email").click();
    await page.locator("#email").pressSequentially(`sales-${ts}@example.com`, { delay: 20 });
    await page.locator("#email").blur();
    await page.locator("#phone").click();
    await page.locator("#phone").pressSequentially("555-0100", { delay: 20 });
    await page.locator("#phone").blur();
    await page.locator("#address").click();
    await page.locator("#address").pressSequentially("123 Market Street", { delay: 20 });
    await page.locator("#address").blur();
    await page.locator("#notes").click();
    await page.locator("#notes").pressSequentially("Primary landscaping account", { delay: 20 });
    await page.locator("#notes").blur();
    await page.locator("#name").click();
    await page.locator("#name").pressSequentially(customerName, { delay: 20 });
    await expect(page.locator("#name")).toHaveValue(customerName);
    await page.locator("#name").blur();

    await page.getByRole("button", { name: "Create Customer" }).click();
    await page.waitForURL(/\/sales\/customers\/[0-9a-f-]+$/);
    await page.goto("/sales/customers");
    await filterList(page, "Search customers", customerName);

    // UI — verify the row renders correctly in the list
    const fullRow = page.getByRole("row", { name: new RegExp(customerName) });
    await expect(fullRow).toBeVisible();
    await expect(fullRow).toContainText(customerName);
    await expect(fullRow).toContainText(`sales-${ts}@example.com`);
    await expect(fullRow).toContainText("555-0100");
    await expect(fullRow).not.toContainText("Invalid");

    // DB — verify the data was saved correctly
    const rows = await db
      .select()
      .from(salesCustomers)
      .where(eq(salesCustomers.name, customerName));
    expect(rows).toHaveLength(1);

    const customer = rows[0];
    customerId = customer.id;

    expect(customer.email).toBe(`sales-${ts}@example.com`);
    expect(customer.phone).toBe("555-0100");
    expect(customer.address).toBe("123 Market Street");
    expect(customer.notes).toBe("Primary landscaping account");
    expect(customer.deletedAt).toBeNull();
  });

  test("creates a minimal customer", async ({ page, db }) => {
    extraCustomerName = `Backup Builder ${ts}`;

    await page.goto("/sales/customers/new");
    await expect(page.getByText("Add Customer")).toBeVisible();

    await page.locator("#name").click();
    await page.locator("#name").pressSequentially(extraCustomerName, { delay: 20 });
    await expect(page.locator("#name")).toHaveValue(extraCustomerName);
    await page.locator("#name").blur();

    await page.getByRole("button", { name: "Create Customer" }).click();
    await page.waitForURL(/\/sales\/customers\/[0-9a-f-]+$/);
    await page.goto("/sales/customers");
    await filterList(page, "Search customers", extraCustomerName);

    // UI — verify the row renders correctly (minimal fields show dashes)
    const minRow = page.getByRole("row", { name: new RegExp(extraCustomerName) });
    await expect(minRow).toBeVisible();
    await expect(minRow).toContainText(extraCustomerName);
    await expect(minRow).not.toContainText("Invalid");

    // DB — verify the data was saved correctly
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
    await expect(page.locator('input[placeholder="0.00"]').first()).toHaveValue(/29\.99/);

    await page.getByRole("button", { name: "Add Item" }).click();
    const row2 = page.locator("tbody tr").last();
    await row2.getByPlaceholder("Search products...").click();
    await row2.getByPlaceholder("Search products...").fill(secondaryProductName);
    await page.getByRole("option", { name: new RegExp(secondaryProductName) }).click();
    await row2.locator('input[placeholder="0"]').first().fill("2");

    await page.getByLabel("Notes").fill("Full lifecycle test order");

    await page.getByRole("button", { name: "Create Order" }).click();
    await page.waitForURL(/\/sales\/orders\/[0-9a-f-]+$/);

    // UI — verify the detail page renders the order correctly
    await expect(page.locator("main").getByText("Draft", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(customerName)).toBeVisible();
    await expect(page.getByText("$113.97")).toBeVisible();
    await expect(page.getByText(primaryProductName)).toBeVisible();
    await expect(page.getByText(secondaryProductName)).toBeVisible();
    await expect(page.getByText("Full lifecycle test order")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Invalid");

    // DB — verify the data was saved correctly
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
    expect(order.totalAmount).toBe("113.97");
    expect(order.deletedAt).toBeNull();

    const lineRows = await db
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.id));
    expect(lineRows).toHaveLength(2);

    const lineByItem = new Map(lineRows.map((line) => [line.itemId, line]));
    expect(lineByItem.get(primaryProductId)?.quantity).toBe("3.0000");
    expect(lineByItem.get(primaryProductId)?.lineTotal).toBe("89.97");
    expect(lineByItem.get(secondaryProductId)?.quantity).toBe("2.0000");
    expect(lineByItem.get(secondaryProductId)?.lineTotal).toBe("24.00");

    const [primaryItem] = await db.select().from(items).where(eq(items.id, primaryProductId));
    const [secondaryItem] = await db.select().from(items).where(eq(items.id, secondaryProductId));
    expect(primaryItem.committedQty).toBe("0.0000");
    expect(secondaryItem.committedQty).toBe("0.0000");
  });

  test("edits the draft order", async ({ page, db }) => {
    await page.goto(`/sales/orders/${fullOrderId}/edit`);
    await expect(page.getByText("Edit Sales Order")).toBeVisible();

    const quantityInputs = page.locator('input[placeholder="0"]');
    await quantityInputs.first().fill("5");
    await page.getByLabel("Notes").fill("Updated to 5 units");

    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.waitForURL(`**/sales/orders/${fullOrderId}`);
    await expect(page.getByRole("heading", { name: fullOrderNumber })).toBeVisible();

    // UI — verify the detail page reflects the edits
    await expect(page.getByText("$173.95")).toBeVisible();
    await expect(page.getByText("Updated to 5 units")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Invalid");

    // DB — verify the data was saved correctly
    const orderRows = await db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.id, fullOrderId));
    expect(orderRows).toHaveLength(1);
    expect(orderRows[0].status).toBe("draft");
    expect(orderRows[0].notes).toBe("Updated to 5 units");
    expect(orderRows[0].totalAmount).toBe("173.95");
  });

  test("confirms the draft order and commits stock", async ({ page, db }) => {
    await page.goto(`/sales/orders/${fullOrderId}/edit`);
    await expect(page.getByText("Edit Sales Order")).toBeVisible();

    await page.getByRole("combobox").filter({ hasText: "Draft" }).first().click();
    await page.getByRole("option", { name: "Confirmed" }).click();
    await page.getByRole("button", { name: "Save Changes" }).click();
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

  test("confirmed orders are read-only from detail", async ({ page }) => {
    await page.goto(`/sales/orders/${fullOrderId}`);
    await expect(page.getByRole("heading", { name: fullOrderNumber })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit" })).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  });

  test("cancels the confirmed order and releases committed stock", async ({ page, db }) => {
    await page.goto(`/sales/orders/${fullOrderId}`);
    await expect(page.getByRole("heading", { name: fullOrderNumber })).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Cancel Order" }).click();
    await expect(page.locator("main").getByText("Cancelled", { exact: true }).first()).toBeVisible();

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

    // UI — deleted order should not appear in the list
    await expect(page.getByText(`No results for "${fullOrderNumber}"`)).toBeVisible();

    // DB — verify soft delete
    const orderRows = await db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.id, fullOrderId));
    expect(orderRows).toHaveLength(1);
    expect(orderRows[0].deletedAt).not.toBeNull();
  });

  test("creates a draft order that will oversell on confirmation", async ({ page, db }) => {
    await page.goto("/sales/orders/new");
    await expect(page.getByText("Add Sales Order")).toBeVisible();

    const customerInput = page.getByPlaceholder("Search customers...");
    await customerInput.click();
    await customerInput.fill(extraCustomerName);
    await page.getByRole("option", { name: new RegExp(extraCustomerName) }).click();

    const productInput = page.getByPlaceholder("Search products...");
    await productInput.click();
    await productInput.fill(oversellProductName);
    await page.getByRole("option", { name: new RegExp(oversellProductName) }).click();
    await page.locator('input[placeholder="0"]').first().fill("1");

    await page.getByRole("button", { name: "Create Order" }).click();
    await page.waitForURL(/\/sales\/orders\/[0-9a-f-]+$/);

    // UI — verify detail page shows the oversell order
    await expect(page.locator("main").getByText("Draft", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(oversellProductName)).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Invalid");

    const orderRows = await db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.customerId, extraCustomerId));
    const order = orderRows.find((row) => row.deletedAt == null);
    expect(order).toBeTruthy();

    oversellOrderId = order!.id;
    oversellOrderNumber = order!.orderNumber;
    expect(order!.status).toBe("draft");
  });

  test("shows the oversell dialog and confirms anyway", async ({ page, db }) => {
    await page.goto(`/sales/orders/${oversellOrderId}/edit`);
    await expect(page.getByText("Edit Sales Order")).toBeVisible();

    await page.getByRole("combobox").filter({ hasText: "Draft" }).first().click();
    await page.getByRole("option", { name: "Confirmed" }).click();
    await page.getByRole("button", { name: "Save Changes" }).click();

    const oversellDialog = page.getByRole("alertdialog", { name: "Confirm Oversell?" });
    await expect(oversellDialog).toBeVisible();
    await oversellDialog.getByText("Current Committed", { exact: true }).hover();
    await expect(
      page.getByText("Quantity already reserved by confirmed sales orders.")
    ).toBeVisible();
    await oversellDialog.getByRole("button", { name: "Confirm Anyway" }).scrollIntoViewIfNeeded();
    await oversellDialog.getByRole("button", { name: "Confirm Anyway" }).click();
    await page.waitForURL(`**/sales/orders/${oversellOrderId}`);
    await expect(page.getByRole("heading", { name: oversellOrderNumber })).toBeVisible();

    // UI — status badge should show Confirmed
    await expect(page.locator("main").getByText("Confirmed", { exact: true }).first()).toBeVisible();

    const orderRows = await db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.id, oversellOrderId));
    expect(orderRows).toHaveLength(1);
    expect(orderRows[0].status).toBe("confirmed");

    const [oversellItem] = await db.select().from(items).where(eq(items.id, oversellProductId));
    expect(oversellItem.committedQty).toBe("1.0000");
  });

  test("deletes the confirmed oversell order and recomputes committed stock", async ({ page, db }) => {
    await page.goto(`/sales/orders/${oversellOrderId}`);
    await expect(page.getByRole("heading", { name: oversellOrderNumber })).toBeVisible();

    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete Order" }).click();
    await page.waitForURL("**/sales/orders");
    await filterList(page, "Search orders", oversellOrderNumber);

    // UI — deleted order should not appear in the list
    await expect(page.getByText(`No results for "${oversellOrderNumber}"`)).toBeVisible();

    // DB — verify soft delete and committed stock recompute
    const orderRows = await db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.id, oversellOrderId));
    expect(orderRows).toHaveLength(1);
    expect(orderRows[0].deletedAt).not.toBeNull();

    const [oversellItem] = await db.select().from(items).where(eq(items.id, oversellProductId));
    expect(oversellItem.committedQty).toBe("0.0000");
  });

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

    // UI — deleted customer should not appear in the list
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

    const productRows = await db.select().from(items).where(eq(items.id, secondaryProductId));
    expect(productRows).toHaveLength(1);
    expect(productRows[0].deletedAt).not.toBeNull();
  });
});
