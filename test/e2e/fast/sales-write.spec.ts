import { asc, eq } from "drizzle-orm";
import { test, expect, getIdFromUrl, selectDate } from "../fixtures";
import {
  inventoryItemBalances,
  salesOrderLines,
  salesOrders,
  customers as salesCustomers,
} from "../../../lib/db/schema";
import { createItem, getUnitId } from "../../helpers/api";

test.describe("Sales write-path smoke", () => {
  test.describe.configure({ mode: "serial" });

  const ts = Date.now();
  const unitId = getUnitId();
  const customerName = `Fast Customer ${ts}`;
  const productName = `Fast Sales Product ${ts}`;
  let customerId = "";
  let productId = "";
  let orderId = "";

  test("creates and edits a customer through the browser form", async ({ page, db }) => {
    await page.goto("/sales/customers/new");
    await expect(page.getByText("Add Customer")).toBeVisible();

    await page.getByLabel("Name").fill(customerName);
    await page.getByLabel("Email").fill(`fast-sales-${ts}@example.com`);
    await page.getByLabel("Phone").fill("555-0300");
    await page.locator("#customer-billing-line1").fill("100 Market Street");
    await page.getByLabel("Notes").fill("Fast customer smoke test");

    const [createCustomerResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/api/customers")
      ),
      page.getByRole("button", { name: "Create Customer" }).click(),
    ]);
    expect(createCustomerResponse.status()).toBe(201);
    await page.waitForURL(/\/sales\/customers\/[0-9a-f-]+$/);
    customerId = getIdFromUrl(page.url());
    await expect(page.getByRole("heading", { name: customerName })).toBeVisible();

    const [customer] = await db
      .select()
      .from(salesCustomers)
      .where(eq(salesCustomers.id, customerId));
    expect(customer.email).toBe(`fast-sales-${ts}@example.com`);
    expect(customer.phone).toBe("555-0300");
    expect(customer.billingLine1).toBe("100 Market Street");
    expect(customer.notes).toBe("Fast customer smoke test");

    await page.getByRole("link", { name: "Edit" }).click();
    await page.waitForURL(`**/sales/customers/${customerId}/edit`);
    await page.getByLabel("Phone").fill("555-0310");
    await page.getByLabel("Notes").fill("Fast customer updated");
    const updateCustomerResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        response.url().endsWith(`/api/customers/${customerId}`)
    );
    await page.getByRole("button", { name: "Save Changes" }).click();
    expect((await updateCustomerResponsePromise).status()).toBe(200);
    await page.waitForURL(`**/sales/customers/${customerId}`);

    const [updatedCustomer] = await db
      .select()
      .from(salesCustomers)
      .where(eq(salesCustomers.id, customerId));
    expect(updatedCustomer.phone).toBe("555-0310");
    expect(updatedCustomer.notes).toBe("Fast customer updated");
  });

  test("creates a draft sales order through the browser form", async ({ page, db }) => {
    const productResult = await createItem({
      name: productName,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `FAST-SALES-${ts}`,
      category: `Fast Sales ${ts}`,
      description: "Product for fast sales smoke test",
      defaultPurchasePrice: null,
      defaultSellingPrice: "34.99",
      stock: "0",
      safetyStock: "0",
      bom: [],
    });

    expect(productResult.status).toBe(201);
    productId = productResult.body.id;

    await page.goto("/sales/orders/new");
    await expect(page.getByText("Add Sales Order")).toBeVisible();

    const customerInput = page.getByPlaceholder("Search customers...");
    await customerInput.click();
    await customerInput.pressSequentially(customerName);
    await page.getByRole("option", { name: new RegExp(customerName) }).click();

    await selectDate(page, page.getByLabel("Requested Date"), "2026-04-15");

    const itemInput = page.getByPlaceholder("Search items...");
    await itemInput.click();
    await itemInput.pressSequentially(productName);
    await page.getByRole("option", { name: new RegExp(productName) }).click();
    await page.locator('input[placeholder="0"]').first().fill("3");
    await page.locator('input[placeholder="0.00"]').first().fill("34.99");
    await page.getByLabel("Notes").fill("Fast order smoke test");

    const [createOrderResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/api/sales-orders")
      ),
      page.getByRole("button", { name: "Create Order" }).click(),
    ]);
    expect(createOrderResponse.status()).toBe(201);
    await page.waitForURL(/\/sales\/orders\/[0-9a-f-]+$/);
    orderId = getIdFromUrl(page.url());
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/SO-\d{4}-\d{4}/);

    const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, orderId));
    expect(order.customerId).toBe(customerId);
    expect(order.customerName).toBe(customerName);
    expect(order.status).toBe("draft");
    expect(order.requestedDate).toBe("2026-04-15");
    expect(order.notes).toBe("Fast order smoke test");

    const [line] = await db
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, orderId))
      .orderBy(asc(salesOrderLines.sortOrder));
    expect(line.itemId).toBe(productId);
    expect(line.quantity).toBe("3.0000");
    expect(line.unitPrice).toBe("34.99");

    const [productBalance] = await db
      .select()
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, productId));
    expect(productBalance?.committedQty ?? "0.0000").toBe("0.0000");
  });
});
