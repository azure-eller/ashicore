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
import { createItem, getUnitId, testFetch } from "../helpers/api";

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

test.beforeEach(async ({ context }) => {
  const { name, value } = parseCookie(SESSION_COOKIE);
  await context.addCookies([
    { name, value, domain: "localhost", path: "/" },
  ]);
});

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

  let fullOrderId: string;
  let fullOrderNumber: string;
  let guardOrderId: string;
  let noManufacturingOrderId: string;
  let noManufacturingOrderNumber: string;

  test("creates product fixtures for the sales flow", async ({ db }) => {
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
      stock: "50",
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
      stock: "0",
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
    await expect(page.getByText("Add Customer")).toBeVisible();

    await page.getByLabel("Name").fill(customerName);
    await page.getByLabel("Email").fill(`sales-${run}@example.com`);
    await page.getByLabel("Phone").fill("555-0100");
    await page.getByLabel("Address").fill("123 Market Street");
    await page.getByLabel("Notes").fill("Primary landscaping account");

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

    await page.getByLabel("Name").fill(extraCustomerName);

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
    expect(order.deletedAt).toBeNull();

    const lineRows = await db
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.id));
    expect(lineRows).toHaveLength(2);

    const lineByItem = new Map(lineRows.map((line) => [line.itemId, line]));
    expect(lineByItem.get(primaryProductId)?.quantity).toBe("3.0000");
    expect(lineByItem.get(secondaryProductId)?.quantity).toBe("2.0000");

    const computedTotal = lineRows.reduce(
      (sum, line) => sum + parseFloat(line.lineTotal),
      0
    );
    expect(parseFloat(order.totalAmount)).toBeCloseTo(computedTotal, 2);

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

    const updatedLineRows = await db
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, fullOrderId));
    const updatedTotal = updatedLineRows.reduce(
      (sum, line) => sum + parseFloat(line.lineTotal),
      0
    );
    expect(parseFloat(orderRows[0].totalAmount)).toBeCloseTo(updatedTotal, 2);
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
          quantity: "1",
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
    await expect(oversellDialog).toBeVisible();
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
    expect(primaryItemAfterConfirm.committedQty).toBe("1.0000");

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

          return {
            primary: primaryItem?.committedQty ?? null,
            secondary: secondaryItem?.committedQty ?? null,
          };
        },
        { timeout: 15_000 }
      )
      .toEqual({
        primary: "5.0000",
        secondary: "2.0000",
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
    await expect(page.getByText("Sales Order Preview")).toBeVisible();

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
    await expect(page.getByText("Sales Order Preview")).toBeVisible();
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
        body: JSON.stringify({ confirmOversell: false }),
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
    await detailCreateButton.hover({ force: true });
    await expect(
      page.getByText("No active BOM-backed products remain on this order.")
    ).toBeVisible();

    await page.goto("/sales/orders");
    await filterList(page, "Search orders", noManufacturingOrderNumber);

    const disabledRow = page.getByRole("row", {
      name: new RegExp(noManufacturingOrderNumber),
    });
    const rowCreateButton = disabledRow.getByRole("button", {
      name: "Create MOs",
    });
    await expect(rowCreateButton).toBeDisabled();
    await rowCreateButton.hover({ force: true });
    await expect(
      page.getByText("No active BOM-backed products remain on this order.")
    ).toBeVisible();

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
      .toBe("2.0000");
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
  /*  Flow 3 — Referential integrity                                  */
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
