import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Locator, Page } from "@playwright/test";
import { test, expect, filterList, getIdFromUrl, selectDate } from "../fixtures";
import type { SalesOrderListRow } from "@/app/(dashboard)/sales/types";
import {
  deriveSalesOrderLane,
  groupSalesOrdersByLane,
  sortSalesOrdersForBoard,
} from "@/app/(dashboard)/sales/orders-board/sales-order-lane-model";
import { filterOrdersForBoard } from "@/app/(dashboard)/sales/orders-board/sales-order-board-filters";
import { getSalesOrderDropCommand } from "@/app/(dashboard)/sales/orders-board/sales-order-drop-rules";
import {
  inventoryItemBalances,
  inventoryLotBalances,
  inventoryReservationsSummary,
  customerContacts,
  customerCorrespondence,
  customerCorrespondenceAttendees,
  customerProjectFiles,
  customerProjects,
  lots,
  manufacturingOrders,
  purchaseOrderLines,
  stockAllocations,
  salesOrderLines,
  salesShipmentLines,
  salesOrders,
  salesShipments,
  customers as salesCustomers,
} from "../../../lib/db/schema";
import {
  createCustomer,
  createItem,
  createPurchaseOrder,
  createSalesOrder,
  confirmSalesOrder,
  createSupplier,
  fulfillSalesOrder,
  getUnitId,
  receivePurchaseOrder,
  submitPurchaseOrder,
  testFetch,
  updateItem,
} from "../../helpers/api";

function utcDateDaysFromToday(days: number) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

async function showSalesOrderStatus(page: Parameters<typeof filterList>[0], status: string) {
  if (status === "Cancelled") {
    await page.getByRole("button", { name: /Show cancelled orders lane/ }).click();
  }
}

function salesOrderCard(page: Page, orderNumber: string) {
  return page
    .locator('[data-testid="sales-order-card"]')
    .filter({ hasText: orderNumber })
    .first();
}

async function expandSalesOrderCard(page: Page, orderNumber: string) {
  const card = salesOrderCard(page, orderNumber);
  await card.click();
  return card;
}

function salesOrderLineRow(page: Page, lineName: string) {
  return page
    .locator('[data-testid="sales-order-line-row"]')
    .filter({ hasText: lineName })
    .first();
}

function boardLogicOrder(
  overrides: Partial<SalesOrderListRow> & { id: string; orderNumber: string }
): SalesOrderListRow {
  return {
    id: overrides.id,
    orderNumber: overrides.orderNumber,
    customerName: overrides.customerName ?? "Board Customer",
    customerEmail: overrides.customerEmail ?? null,
    notes: overrides.notes ?? null,
    status: overrides.status ?? "confirmed",
    orderDate: overrides.orderDate ?? "2026-04-01",
    shipDate: overrides.shipDate ?? "2026-04-15",
    requestedDate: overrides.requestedDate ?? "2026-04-15",
    shippedAt: overrides.shippedAt ?? null,
    totalAmount: overrides.totalAmount ?? "100",
    itemSummary: overrides.itemSummary ?? "Board Product",
    shipments: overrides.shipments ?? [],
    lines:
      overrides.lines ??
      [
        {
          masterName: "Board Product",
          attrs: [],
          quantity: "10",
          shippedQuantity: "0",
          allocatedQty: "0",
          shortQty: "0",
          sourceSummary: "—",
          unitName: "Each",
        },
      ],
    fulfillmentSummary:
      overrides.fulfillmentSummary ??
      {
        remainingQty: "10",
        allocatedQty: "10",
        shortQty: "0",
        productionAllocatedQty: "0",
        label: "10/10 allocated",
      },
    hasManufacturableLines: overrides.hasManufacturableLines ?? false,
    manufacturableLineCount: overrides.manufacturableLineCount ?? 0,
    manufacturableDisabledReason: overrides.manufacturableDisabledReason ?? null,
    openManufacturingOrderCount: overrides.openManufacturingOrderCount ?? 0,
    shippingReadiness:
      overrides.shippingReadiness ??
      { state: "ready", message: "Ready", blockers: [] },
    deletedAt: overrides.deletedAt ?? null,
    createdAt: overrides.createdAt ?? new Date("2026-04-01T00:00:00Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-04-01T00:00:00Z"),
  };
}

async function dragToCenter(page: Page, source: Locator, target: Locator) {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();

  if (!sourceBox || !targetBox) {
    throw new Error("Could not resolve drag source or target bounds.");
  }

  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2
  );
  await page.waitForTimeout(75);
  await page.mouse.down();
  await page.waitForTimeout(75);
  await page.mouse.move(
    (sourceBox.x + sourceBox.width / 2 + targetBox.x + targetBox.width / 2) / 2,
    (sourceBox.y + sourceBox.height / 2 + targetBox.y + targetBox.height / 2) / 2,
    { steps: 12 }
  );
  await page.waitForTimeout(75);
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    { steps: 24 }
  );
  await page.waitForTimeout(75);
  await page.mouse.up();
}

test.describe("Sales order board pure helpers", () => {
  test("derives, filters, groups, and sorts board orders", () => {
    const draft = boardLogicOrder({
      id: "00000000-0000-0000-0000-000000000001",
      orderNumber: "SO-2",
      status: "draft",
      customerName: "Alpha",
      totalAmount: "20",
    });
    const short = boardLogicOrder({
      id: "00000000-0000-0000-0000-000000000002",
      orderNumber: "SO-1",
      customerName: "Beta",
      totalAmount: "500",
      fulfillmentSummary: {
        remainingQty: "10",
        allocatedQty: "2",
        shortQty: "8",
        productionAllocatedQty: "0",
        label: "2/10 allocated · 8 short",
      },
      shippingReadiness: { state: "insufficient_stock", message: "Short", blockers: ["Short"] },
    });
    const production = boardLogicOrder({
      id: "00000000-0000-0000-0000-000000000003",
      orderNumber: "SO-3",
      openManufacturingOrderCount: 1,
      fulfillmentSummary: {
        remainingQty: "10",
        allocatedQty: "4",
        shortQty: "6",
        productionAllocatedQty: "6",
        label: "Waiting production",
      },
    });

    expect(deriveSalesOrderLane(draft)).toBe("draft");
    expect(deriveSalesOrderLane(short)).toBe("supply_needed");
    expect(deriveSalesOrderLane(production)).toBe("in_production");

    const filtered = filterOrdersForBoard([draft, short, production], {
      search: "beta",
      laneFilter: "all",
      customerFilter: "all",
      showCancelled: false,
      sortMode: "shipDate",
    });
    expect(filtered.map((order) => order.orderNumber)).toEqual(["SO-1"]);

    const grouped = groupSalesOrdersByLane([draft, short, production]);
    expect(grouped.draft).toHaveLength(1);
    expect(grouped.supply_needed).toHaveLength(1);
    expect(grouped.in_production).toHaveLength(1);

    expect(sortSalesOrdersForBoard([draft, short], "value").map((order) => order.orderNumber)).toEqual([
      "SO-1",
      "SO-2",
    ]);
  });

  test("maps board drops to sales commands without fake lane mutations", () => {
    const draft = boardLogicOrder({
      id: "00000000-0000-0000-0000-000000000011",
      orderNumber: "SO-11",
      status: "draft",
    });
    const manufacturableShort = boardLogicOrder({
      id: "00000000-0000-0000-0000-000000000012",
      orderNumber: "SO-12",
      hasManufacturableLines: true,
      manufacturableLineCount: 1,
      fulfillmentSummary: {
        remainingQty: "10",
        allocatedQty: "0",
        shortQty: "10",
        productionAllocatedQty: "0",
        label: "0/10 allocated · 10 short",
      },
      shippingReadiness: { state: "insufficient_stock", message: "Short", blockers: ["Short"] },
    });
    const ready = boardLogicOrder({
      id: "00000000-0000-0000-0000-000000000013",
      orderNumber: "SO-13",
    });
    const shipped = boardLogicOrder({
      id: "00000000-0000-0000-0000-000000000014",
      orderNumber: "SO-14",
      status: "shipped",
      shippingReadiness: { state: "shipped", message: "Shipped", blockers: [] },
    });

    expect(
      getSalesOrderDropCommand({ order: draft, fromLane: "draft", toLane: "ready_to_ship" })
    ).toMatchObject({ type: "confirm-order", orderId: draft.id });
    expect(
      getSalesOrderDropCommand({ order: draft, fromLane: "draft", toLane: "shipped" })
    ).toMatchObject({ type: "blocked" });
    expect(
      getSalesOrderDropCommand({
        order: manufacturableShort,
        fromLane: "supply_needed",
        toLane: "in_production",
      })
    ).toEqual({ type: "open-create-mos", orderId: manufacturableShort.id });
    expect(
      getSalesOrderDropCommand({
        order: manufacturableShort,
        fromLane: "supply_needed",
        toLane: "ready_to_ship",
      })
    ).toEqual({ type: "prepare-for-shipping", orderId: manufacturableShort.id });
    expect(
      getSalesOrderDropCommand({ order: ready, fromLane: "ready_to_ship", toLane: "shipped" })
    ).toEqual({ type: "open-ship-dialog", orderId: ready.id });
    expect(
      getSalesOrderDropCommand({ order: shipped, fromLane: "shipped", toLane: "ready_to_ship" })
    ).toMatchObject({ type: "blocked" });
  });
});

test.describe("Sales write-path smoke", () => {
  test.describe.configure({ mode: "serial" });

  const ts = Date.now();
  const unitId = getUnitId();
  const customerName = `Fast Customer ${ts}`;
  const productName = `Fast Sales Product ${ts}`;
  const orderNote =
    "Fast order smoke test note appears in the sales order table notes column.";
  let customerId = "";
  let productId = "";
  let orderId = "";
  let crmProjectId = "";

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

  test("adds customer contacts, correspondence, and projects from detail", async ({
    page,
    db,
  }) => {
    await page.goto(`/sales/customers/${customerId}`);
    await expect(page.getByRole("heading", { name: customerName })).toBeVisible();

    await page.getByRole("button", { name: /^Contacts/ }).click();
    await page.getByRole("button", { name: "Add contact" }).click();
    await expect(page.getByRole("dialog", { name: "Add contact" })).toBeVisible();
    await page.getByLabel("Full name").fill(`Spencer CRM ${ts}`);
    await page.getByLabel("Title").fill("Project lead");
    await page.getByLabel("Email").fill(`spencer-crm-${ts}@example.com`);
    await page.getByLabel("Phone").fill("555-0440");
    await page.getByText("Primary").click();
    await page.getByText("Shipping").click();
    await page.getByLabel("Notes").fill("Prefers shipping updates.");

    const [contactResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith(`/api/customers/${customerId}/contacts`)
      ),
      page.getByRole("button", { name: "Save contact" }).click(),
    ]);
    expect(contactResponse.status()).toBe(201);
    await expect(page.getByText(`Spencer CRM ${ts}`)).toBeVisible();

    const [contact] = await db
      .select()
      .from(customerContacts)
      .where(eq(customerContacts.customerId, customerId));
    expect(contact.name).toBe(`Spencer CRM ${ts}`);
    expect(contact.isPrimary).toBe(true);
    expect(contact.receivesShipping).toBe(true);

    await page.getByRole("button", { name: /^Activity/ }).click();
    await page.getByPlaceholder("Optional title").fill("Group install call");
    await page.getByPlaceholder("Jot it down.").fill("Discussed soil test and delivery timing.");
    await page.getByRole("button", { name: new RegExp(`Spencer`) }).click();

    const [activityResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith(`/api/customers/${customerId}/correspondence`)
      ),
      page.getByRole("button", { name: "Log note" }).click(),
    ]);
    expect(activityResponse.status()).toBe(201);
    await expect(page.getByText("Group install call")).toBeVisible();

    const [activity] = await db
      .select()
      .from(customerCorrespondence)
      .where(eq(customerCorrespondence.customerId, customerId));
    expect(activity.title).toBe("Group install call");
    expect(activity.body).toBe("Discussed soil test and delivery timing.");

    const [attendee] = await db
      .select()
      .from(customerCorrespondenceAttendees)
      .where(eq(customerCorrespondenceAttendees.correspondenceId, activity.id));
    expect(attendee.contactId).toBe(contact.id);
    expect(attendee.contactName).toBe(contact.name);

    await page.getByRole("button", { name: /^Projects/ }).click();
    await page.getByRole("button", { name: "New project" }).click();
    await expect(page.getByRole("dialog", { name: "New project" })).toBeVisible();
    await page.getByLabel("Project name").fill(`Example Construction ${ts}`);
    await page.getByLabel("Summary").fill("Drop specs, soil tests, and blueprint notes here.");

    const [projectResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith(`/api/customers/${customerId}/projects`)
      ),
      page.getByRole("button", { name: "Save project" }).click(),
    ]);
    expect(projectResponse.status()).toBe(201);
    await expect(
      page.getByRole("button", { name: new RegExp(`Example Construction ${ts}`) })
    ).toBeVisible();

    const [project] = await db
      .select()
      .from(customerProjects)
      .where(eq(customerProjects.customerId, customerId));
    expect(project.name).toBe(`Example Construction ${ts}`);
    expect(project.status).toBe("planning");
    expect(project.summary).toBe("Drop specs, soil tests, and blueprint notes here.");
    crmProjectId = project.id;
  });

  test("uploads, downloads, and deletes a customer project file", async ({
    page,
    db,
  }) => {
    test.skip(
      !process.env.BLOB_READ_WRITE_TOKEN,
      "Live Vercel Blob credentials are required for the upload smoke."
    );

    await page.goto(`/sales/customers/${customerId}`);
    await expect(page.getByRole("heading", { name: customerName })).toBeVisible();

    await page.getByRole("button", { name: /^Projects/ }).click();
    await page.getByRole("button", { name: new RegExp(`Example Construction ${ts}`) }).click();

    const filename = `soil-test-${ts}.txt`;
    const content = `Soil test upload smoke ${ts}`;
    const uploadResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/customers/${customerId}/projects/${crmProjectId}/files`)
    );
    await page.locator('input[type="file"]').setInputFiles({
      name: filename,
      mimeType: "text/plain",
      buffer: Buffer.from(content),
    });

    expect((await uploadResponsePromise).status()).toBe(201);
    await expect(page.getByText(filename)).toBeVisible();

    const [file] = await db
      .select()
      .from(customerProjectFiles)
      .where(eq(customerProjectFiles.projectId, crmProjectId));
    expect(file.filename).toBe(filename);
    expect(file.contentType).toBe("text/plain");
    expect(Number(file.sizeBytes)).toBe(content.length);

    const downloadResponse = await page.request.get(
      `/api/customers/${customerId}/projects/${crmProjectId}/files/${file.id}`
    );
    expect(downloadResponse.status()).toBe(200);
    expect(await downloadResponse.text()).toBe(content);

    const deleteResponse = await page.request.delete(
      `/api/customers/${customerId}/projects/${crmProjectId}/files/${file.id}`
    );
    expect(deleteResponse.status()).toBe(200);

    const [deletedFile] = await db
      .select()
      .from(customerProjectFiles)
      .where(eq(customerProjectFiles.id, file.id));
    expect(deletedFile.deletedAt).not.toBeNull();
  });

  test("creates a draft sales order through the browser form", async ({ page, db }) => {
    const componentResult = await createItem({
      name: `Fast Sales Component ${ts}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-SALES-COMP-${ts}`,
      category: `Fast Sales ${ts}`,
      description: "Component for fast sales smoke product",
      defaultPurchasePrice: "1",
      defaultSellingPrice: null,
      stock: "10",
      safetyStock: "0",
      bom: [],
    });
    expect(componentResult.status).toBe(201);
    const componentId = componentResult.body.id as string;

    const productResult = await createItem({
      name: productName,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `FAST-SALES-${ts}`,
      category: `Fast Sales ${ts}`,
      description: "Product for fast sales smoke test",
      defaultPurchasePrice: null,
      defaultSellingPrice: "34.99",
      stock: "3",
      safetyStock: "0",
      bom: [{ componentId, quantity: "1" }],
    });

    expect(productResult.status).toBe(201);
    productId = productResult.body.id;

    await page.goto("/sales/orders/new");
    await expect(page.getByText("Add Sales Order")).toBeVisible();

    const customerInput = page.getByPlaceholder("Search customers...");
    await customerInput.click();
    await customerInput.pressSequentially(customerName);
    await page.getByRole("option", { name: new RegExp(customerName) }).click();

    await selectDate(page, page.getByLabel("Order Date"), "2026-04-01");
    await selectDate(page, page.getByLabel("Ship Date"), "2026-04-15");
    await selectDate(page, page.getByLabel("Delivery Date"), "2026-04-15");

    const itemInput = page.getByPlaceholder("Search items...");
    await itemInput.click();
    await itemInput.pressSequentially(productName);
    await page.getByRole("option", { name: new RegExp(productName) }).click();
    await page.locator('input[placeholder="0"]').first().fill("3");
    await page.locator('input[placeholder="0.00"]').first().fill("34.99");
    await page.getByLabel("Notes").fill(orderNote);

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
    await expect(
      page.getByRole("heading", { level: 1, name: /SO-\d{4}-\d{4}/ })
    ).toBeVisible({ timeout: 15_000 });

    const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, orderId));
    expect(order.customerId).toBe(customerId);
    expect(order.customerName).toBe(customerName);
    expect(order.status).toBe("draft");
    expect(order.orderDate).toBe("2026-04-01");
    expect(order.shipDate).toBe("2026-04-15");
    expect(order.requestedDate).toBe("2026-04-15");
    expect(order.notes).toBe(orderNote);

    await page.goto("/sales/orders");
    await showSalesOrderStatus(page, "Draft");
    await filterList(page, "Search orders", order.orderNumber);
    const listRow = salesOrderCard(page, order.orderNumber);
    const notesIndicator = listRow.getByTestId("sales-order-notes-indicator");
    await expect(notesIndicator).toBeVisible();
    await expect(listRow.getByText(orderNote)).toHaveCount(0);
    await notesIndicator.hover();
    await expect(page.getByRole("tooltip")).toContainText(orderNote);

    await page.goto(`/sales/orders/${orderId}`);
    await expect(
      page.getByRole("heading", { level: 1, name: order.orderNumber })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Create invoice" })).toHaveCount(0);

    const draftInvoiceResponse = await page.request.post(
      `/api/sales-orders/${orderId}/xero-push`
    );
    expect(draftInvoiceResponse.status()).toBe(409);
    expect(await draftInvoiceResponse.json()).toMatchObject({
      error: "Only confirmed, partially shipped, or shipped orders can be invoiced.",
    });

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

    const [confirmResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith(`/api/sales-orders/${orderId}/confirm`)
      ),
      page.getByRole("button", { name: "Confirm" }).click(),
    ]);
    expect(confirmResponse.status()).toBe(200);
    await expect(page.getByText("Confirm the order before shipping.")).toHaveCount(0);
    await expect(page.getByText("Failed to confirm order.")).toHaveCount(0);

    const [confirmedOrder] = await db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, orderId));
    expect(confirmedOrder.status).toBe("confirmed");
    await expect(page.getByRole("button", { name: "Create invoice" })).toBeVisible();

    const shipments = await db
      .select()
      .from(salesShipments)
      .where(eq(salesShipments.salesOrderId, orderId));
    expect(shipments).toHaveLength(1);
    expect(shipments[0].scheduledDate).toBe("2026-04-15");
  });

  test("confirming without a delivery date returns a readable error", async () => {
    const createResponse = await testFetch("/api/sales-orders", {
      method: "POST",
      body: JSON.stringify({
        customerId,
        status: "draft",
        orderDate: "2026-04-01",
        shipDate: null,
        requestedDate: null,
        notes: null,
        lines: [{ itemId: productId, quantity: "1", unitPrice: "34.99" }],
      }),
    });
    expect(createResponse.status).toBe(201);
    const order = await createResponse.json();

    const confirmResponse = await testFetch(`/api/sales-orders/${order.id}/confirm`, {
      method: "POST",
      body: JSON.stringify({ confirmOversell: false }),
    });
    expect(confirmResponse.status).toBe(400);
    const body = await confirmResponse.json();
    expect(body.error).toBe("Ship date is required to confirm a sales order.");
    expect(body.errors.shipDate[0]).toBe(
      "Ship date is required to confirm a sales order"
    );
  });

  test("saving a draft without line items is allowed", async ({ db }) => {
    const createResponse = await testFetch("/api/sales-orders", {
      method: "POST",
      body: JSON.stringify({
        customerId,
        status: "draft",
        orderDate: "2026-04-01",
        shipDate: null,
        requestedDate: null,
        notes: null,
        lines: [],
      }),
    });
    expect(createResponse.status).toBe(201);
    const order = await createResponse.json();

    const lines = await db
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.id));
    expect(lines).toHaveLength(0);
  });

  test("confirming without line items returns a readable error", async () => {
    const createResponse = await testFetch("/api/sales-orders", {
      method: "POST",
      body: JSON.stringify({
        customerId,
        status: "draft",
        orderDate: "2026-04-01",
        shipDate: "2026-04-15",
        requestedDate: "2026-04-15",
        notes: null,
        lines: [],
      }),
    });
    expect(createResponse.status).toBe(201);
    const order = await createResponse.json();

    const confirmResponse = await testFetch(`/api/sales-orders/${order.id}/confirm`, {
      method: "POST",
      body: JSON.stringify({ confirmOversell: false }),
    });
    expect(confirmResponse.status).toBe(400);
    const body = await confirmResponse.json();
    expect(body.error).toBe("Sales order must have at least one line item.");
  });

  test("saving a ship date before the order date returns a readable error", async () => {
    const createResponse = await testFetch("/api/sales-orders", {
      method: "POST",
      body: JSON.stringify({
        customerId,
        status: "draft",
        orderDate: "2026-04-10",
        shipDate: "2026-04-09",
        requestedDate: "2026-04-11",
        notes: null,
        lines: [{ itemId: productId, quantity: "1", unitPrice: "34.99" }],
      }),
    });
    expect(createResponse.status).toBe(400);
    const body = await createResponse.json();
    expect(body.error).toBe("Ship date cannot be before order date");
    expect(body.errors.shipDate[0]).toBe("Ship date cannot be before order date");
  });

  test("duplicates a sales order from the detail actions", async ({ page, db }) => {
    await page.goto(`/sales/orders/${orderId}`);
    await page.getByRole("button", { name: "More actions" }).click();

    const [duplicateResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith(`/api/sales-orders/${orderId}/duplicate`)
      ),
      page.getByRole("menuitem", { name: "Duplicate" }).click(),
    ]);
    expect(duplicateResponse.status()).toBe(201);
    const created = await duplicateResponse.json();
    const duplicateId = created.id as string;
    await page.waitForURL(`**/sales/orders/${duplicateId}`);
    expect(duplicateId).not.toBe(orderId);

    const [duplicate] = await db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.id, duplicateId));
    expect(duplicate.customerId).toBe(customerId);
    expect(duplicate.customerName).toBe(customerName);
    expect(duplicate.status).toBe("draft");
    expect(duplicate.notes).toBe(orderNote);

    const [duplicateLine] = await db
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, duplicateId))
      .orderBy(asc(salesOrderLines.sortOrder));
    expect(duplicateLine.itemId).toBe(productId);
    expect(duplicateLine.quantity).toBe("3.0000");
    expect(duplicateLine.unitPrice).toBe("34.99");
  });

  test("removes line items from detail and expanded list views", async ({
    page,
    db,
  }) => {
    const firstProductName = `Fast Detail Delete Product ${ts}`;
    const secondProductName = `Fast Detail Keep Product ${ts}`;
    const expandedDeleteName = `Fast Expanded Delete Product ${ts}`;
    const expandedKeepName = `Fast Expanded Keep Product ${ts}`;

    const createProduct = async (name: string, sku: string) => {
      const result = await createItem({
        name,
        itemType: "product",
        unitDefinitionId: unitId,
        sku,
        category: `Fast Sales ${ts}`,
        description: "Product for line delete regression",
        defaultPurchasePrice: null,
        defaultSellingPrice: "10",
        stock: "0",
        safetyStock: "0",
        bom: [],
      });
      expect(result.status).toBe(201);
      return result.body.id as string;
    };

    const detailDeleteId = await createProduct(
      firstProductName,
      `FAST-DETAIL-DELETE-${ts}`
    );
    const detailKeepId = await createProduct(
      secondProductName,
      `FAST-DETAIL-KEEP-${ts}`
    );
    const detailOrderResult = await createSalesOrder({
      customerId,
      status: "draft",
      shipDate: "2026-04-20",
      requestedDate: "2026-04-20",
      notes: "Fast detail line delete regression",
      lines: [
        { itemId: detailDeleteId, quantity: "1", unitPrice: "10" },
        { itemId: detailKeepId, quantity: "2", unitPrice: "10" },
      ],
    });
    expect(detailOrderResult.status).toBe(201);
    const detailOrderId = detailOrderResult.body.id as string;

    await page.goto(`/sales/orders/${detailOrderId}`);
    await page
      .getByRole("row", { name: new RegExp(firstProductName) })
      .getByRole("button", { name: `Delete ${firstProductName}` })
      .click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    const detailDeleteResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        response.url().endsWith(`/api/sales-orders/${detailOrderId}`)
    );
    await page.getByRole("button", { name: "Delete Line" }).click();
    expect((await detailDeleteResponsePromise).status()).toBe(200);
    await expect(page.getByText(firstProductName)).toHaveCount(0);

    let detailLines = await db
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, detailOrderId))
      .orderBy(asc(salesOrderLines.sortOrder));
    expect(detailLines).toHaveLength(1);
    expect(detailLines[0].itemId).toBe(detailKeepId);

    const expandedDeleteId = await createProduct(
      expandedDeleteName,
      `FAST-EXP-DELETE-${ts}`
    );
    const expandedKeepId = await createProduct(
      expandedKeepName,
      `FAST-EXP-KEEP-${ts}`
    );
    const expandedOrderResult = await createSalesOrder({
      customerId,
      status: "draft",
      shipDate: "2026-04-21",
      requestedDate: "2026-04-21",
      notes: "Fast expanded line delete regression",
      lines: [
        { itemId: expandedDeleteId, quantity: "1", unitPrice: "10" },
        { itemId: expandedKeepId, quantity: "2", unitPrice: "10" },
      ],
    });
    expect(expandedOrderResult.status).toBe(201);
    const expandedOrderId = expandedOrderResult.body.id as string;
    const [expandedOrder] = await db
      .select({ orderNumber: salesOrders.orderNumber })
      .from(salesOrders)
      .where(eq(salesOrders.id, expandedOrderId));

    await page.goto("/sales/orders");
    await filterList(page, "Search orders", expandedOrder.orderNumber);
    await expandSalesOrderCard(page, expandedOrder.orderNumber);
    await expect(salesOrderLineRow(page, expandedDeleteName)).toBeVisible();
    await expect(
      salesOrderLineRow(page, expandedDeleteName)
        .getByRole("link", { name: `Edit ${expandedDeleteName}` })
    ).toHaveCount(0);
    await salesOrderCard(page, expandedOrder.orderNumber)
      .getByRole("button", { name: `More actions for ${expandedOrder.orderNumber}` })
      .click();
    await expect(
      page.getByRole("menuitem", { name: "Edit" })
    ).toHaveAttribute("href", `/sales/orders/${expandedOrderId}/edit`);
    await page.keyboard.press("Escape");

    const expandedDeleteResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        response.url().endsWith(`/api/sales-orders/${expandedOrderId}`)
    );
    await salesOrderLineRow(page, expandedDeleteName)
      .getByRole("button", { name: `Delete ${expandedDeleteName}` })
      .click();
    await page.getByRole("button", { name: "Delete Line" }).click();
    expect((await expandedDeleteResponsePromise).status()).toBe(200);
    await expect(salesOrderLineRow(page, expandedDeleteName)).toHaveCount(0);

    detailLines = await db
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, expandedOrderId))
      .orderBy(asc(salesOrderLines.sortOrder));
    expect(detailLines).toHaveLength(1);
    expect(detailLines[0].itemId).toBe(expandedKeepId);
  });

  test("edits a confirmed unshipped order and refreshes reservations", async ({
    page,
    db,
  }) => {
    const editCustomerResult = await createCustomer({
      name: `Fast Confirmed Edit Customer ${ts}`,
      email: `fast-confirmed-edit-${ts}@example.com`,
    });
    expect(editCustomerResult.status).toBe(201);
    const editCustomerId = editCustomerResult.body.id as string;

    const editItemResult = await createItem({
      name: `Fast Confirmed Edit Material ${ts}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-CONF-EDIT-${ts}`,
      category: `Fast Sales ${ts}`,
      description: "Material for confirmed order edit regression",
      defaultPurchasePrice: "1",
      defaultSellingPrice: "12",
      stock: "10",
      safetyStock: "0",
    });
    expect(editItemResult.status).toBe(201);
    const editItemId = editItemResult.body.id as string;

    const editOrderResult = await createSalesOrder({
      customerId: editCustomerId,
      status: "draft",
      shipDate: "2026-04-18",
      requestedDate: "2026-04-18",
      lines: [{ itemId: editItemId, quantity: "2", unitPrice: "12" }],
    });
    expect(editOrderResult.status).toBe(201);
    const editOrderId = editOrderResult.body.id as string;
    expect((await confirmSalesOrder(editOrderId)).status).toBe(200);

    const [orderBeforeEdit] = await db
      .select({ orderNumber: salesOrders.orderNumber })
      .from(salesOrders)
      .where(eq(salesOrders.id, editOrderId));

    await page.goto(`/sales/orders/${editOrderId}`);
    await expect(
      page.getByRole("heading", { level: 1, name: orderBeforeEdit.orderNumber })
    ).toBeVisible();
    await page.getByRole("link", { name: "Edit" }).click();
    await page.waitForURL(`**/sales/orders/${editOrderId}/edit`);

    await page.locator('input[placeholder="0"]').first().fill("4");
    await page.getByLabel("Notes").fill("Confirmed order edited after approval");

    const updateOrderResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        response.url().endsWith(`/api/sales-orders/${editOrderId}`)
    );
    await page.getByRole("button", { name: "Save Changes" }).click();
    expect((await updateOrderResponsePromise).status()).toBe(200);
    await page.waitForURL(`**/sales/orders/${editOrderId}`);

    const [orderAfterEdit] = await db
      .select({
        status: salesOrders.status,
        notes: salesOrders.notes,
        totalAmount: salesOrders.totalAmount,
      })
      .from(salesOrders)
      .where(eq(salesOrders.id, editOrderId));
    expect(orderAfterEdit.status).toBe("confirmed");
    expect(orderAfterEdit.notes).toBe("Confirmed order edited after approval");
    expect(orderAfterEdit.totalAmount).toBe("48.00");

    const [lineAfterEdit] = await db
      .select({ id: salesOrderLines.id, quantity: salesOrderLines.quantity })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, editOrderId));
    expect(lineAfterEdit.quantity).toBe("4.0000");

    const [balanceAfterEdit] = await db
      .select({
        committedQty: inventoryItemBalances.committedQty,
        demandQty: inventoryItemBalances.demandQty,
        shortageQty: inventoryItemBalances.shortageQty,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, editItemId));
    expect(balanceAfterEdit.committedQty).toBe("4.0000");
    expect(balanceAfterEdit.demandQty).toBe("4.0000");
    expect(balanceAfterEdit.shortageQty).toBe("0.0000");

    const [reservation] = await db
      .select({
        quantity: sql<string>`COALESCE(SUM(${inventoryReservationsSummary.quantity}), 0)`,
      })
      .from(inventoryReservationsSummary)
      .where(eq(inventoryReservationsSummary.itemId, editItemId));
    expect(reservation.quantity).toBe("4.0000");

    const [draftShipmentLine] = await db
      .select({ quantity: salesShipmentLines.quantity })
      .from(salesShipmentLines)
      .innerJoin(
        salesShipments,
        eq(salesShipmentLines.salesShipmentId, salesShipments.id)
      )
      .where(eq(salesShipments.salesOrderId, editOrderId));
    expect(draftShipmentLine.quantity).toBe("4.0000");
  });

  test("expanded order lines show available stock after confirmed reservations", async ({
    page,
    db,
  }) => {
    const reservedCustomerResult = await createCustomer({
      name: `Fast Reserved Stock Customer ${ts}`,
      email: `fast-reserved-stock-${ts}@example.com`,
    });
    expect(reservedCustomerResult.status).toBe(201);
    const reservedCustomerId = reservedCustomerResult.body.id as string;
    const materialName = `Fast Reserved Stock Label ${ts}`;
    const materialSku = `FAST-RESERVED-STOCK-${ts}`;
    const materialResult = await createItem({
      name: materialName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: materialSku,
      category: `Fast Sales ${ts}`,
      description: "Material for expanded order availability label regression",
      defaultPurchasePrice: "1",
      defaultSellingPrice: "10",
      stock: "150",
      safetyStock: "0",
    });
    expect(materialResult.status).toBe(201);
    const materialId = materialResult.body.id as string;

    const orderResult = await createSalesOrder({
      customerId: reservedCustomerId,
      status: "confirmed",
      confirmOversell: true,
      lines: [{ itemId: materialId, quantity: "150", unitPrice: "10" }],
    });
    expect(orderResult.status).toBe(201);
    const reservedOrderId = orderResult.body.id as string;

    const [order] = await db
      .select({ orderNumber: salesOrders.orderNumber })
      .from(salesOrders)
      .where(eq(salesOrders.id, reservedOrderId));

    await page.goto("/sales/orders");
    await showSalesOrderStatus(page, "Confirmed");
    await filterList(page, "Search orders", order.orderNumber);

    await expandSalesOrderCard(page, order.orderNumber);

    const expandedLine = salesOrderLineRow(page, materialName);
    await expect(expandedLine).toContainText(materialName);
    await expect(expandedLine).toContainText("150");
    await expect(page.getByText("150 / 150 units allocated")).toBeVisible();
    await expect(expandedLine).not.toContainText("-200");

    await expandedLine
      .getByRole("button", { name: `Manage allocation for ${materialName}` })
      .click();
    const sheet = page.getByRole("dialog", { name: "Allocation Manager" });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("Supply · Storage");
    await expect(sheet).toContainText("Demand · Orders");
    await expect(sheet.getByTestId("current-allocation-bucket")).toContainText("150");
    await expect(sheet.getByTestId("current-allocation-bucket")).toContainText("Stock");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });

  test("allocation manager supports click and drag token allocation", async ({
    page,
    db,
  }) => {
    const tokenCustomerResult = await createCustomer({
      name: `Fast Token Allocation Customer ${ts}`,
      email: `fast-token-allocation-${ts}@example.com`,
    });
    expect(tokenCustomerResult.status).toBe(201);
    const tokenCustomerId = tokenCustomerResult.body.id as string;
    const tokenComponentResult = await createItem({
      name: `Fast Token Component ${ts}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-TOKEN-COMP-${ts}`,
      category: `Fast Allocation Tokens ${ts}`,
      description: "Component for allocation manager token product",
      defaultPurchasePrice: "1",
      defaultSellingPrice: null,
      stock: "100",
      safetyStock: "0",
      bom: [],
    });
    expect(tokenComponentResult.status).toBe(201);
    const tokenComponentId = tokenComponentResult.body.id as string;
    const tokenMaterialName = `Fast Token Product ${ts}`;
    const tokenMaterialSku = `FAST-TOKEN-PROD-${ts}`;
    const tokenMaterialResult = await createItem({
      name: tokenMaterialName,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: tokenMaterialSku,
      category: `Fast Allocation Tokens ${ts}`,
      description: "Product for allocation manager token interactions",
      defaultPurchasePrice: null,
      defaultSellingPrice: "10",
      stock: "51",
      safetyStock: "0",
      bom: [{ componentId: tokenComponentId, quantity: "1" }],
    });
    expect(tokenMaterialResult.status).toBe(201);
    const tokenMaterialId = tokenMaterialResult.body.id as string;

    const tokenOrderResult = await createSalesOrder({
      customerId: tokenCustomerId,
      status: "draft",
      lines: [{ itemId: tokenMaterialId, quantity: "6", unitPrice: "10" }],
    });
    expect(tokenOrderResult.status).toBe(201);
    const tokenOrderId = tokenOrderResult.body.id as string;
    const competingOrderResult = await createSalesOrder({
      customerId: tokenCustomerId,
      status: "draft",
      shipDate: "2026-05-12",
      lines: [{ itemId: tokenMaterialId, quantity: "3", unitPrice: "10" }],
    });
    expect(competingOrderResult.status).toBe(201);
    const competingOrderId = competingOrderResult.body.id as string;
    const [tokenOrder] = await db
      .select({ orderNumber: salesOrders.orderNumber })
      .from(salesOrders)
      .where(eq(salesOrders.id, tokenOrderId));
    const [competingOrder] = await db
      .select({ orderNumber: salesOrders.orderNumber })
      .from(salesOrders)
      .where(eq(salesOrders.id, competingOrderId));

    await page.goto("/sales/orders");
    await filterList(page, "Search orders", tokenOrder.orderNumber);
    await expandSalesOrderCard(page, tokenOrder.orderNumber);

    await expect(salesOrderLineRow(page, tokenMaterialName)).toBeVisible();
    await salesOrderLineRow(page, tokenMaterialName)
      .getByRole("button", { name: `Manage allocation for ${tokenMaterialName}` })
      .click();

    const sheet = page.getByRole("dialog", { name: "Allocation Manager" });
    const currentBucket = sheet.getByTestId("current-allocation-bucket");
    const stockStack = sheet.getByRole("button", { name: "Allocate all from Stock" });
    await expect(stockStack).toBeVisible();

    await stockStack.click();
    await expect(sheet).toContainText("Picked up");
    await currentBucket.click();
    await expect(currentBucket).toContainText(/Allocated\s*6/);
    await expect(currentBucket).toContainText(/Short\s*—/);

    await sheet.getByRole("button", { name: "Reset" }).click();
    await expect(currentBucket).toContainText(/Allocated\s*0/);
    await expect(currentBucket).toContainText(/Short\s*6/);

    const competingBucket = sheet
      .getByTestId("readonly-allocation-bucket")
      .filter({ hasText: competingOrder.orderNumber });
    await stockStack.click();
    await competingBucket.click();
    await expect(competingBucket).toContainText(/Allocated\s*3/);
    await expect(competingBucket).toContainText(/Short\s*—/);
    await expect(currentBucket).toContainText(/Allocated\s*0/);
    await expect(currentBucket).toContainText(/Short\s*6/);

    await competingBucket.getByLabel("Move 3 from Stock").click();
    await currentBucket.click();
    await expect(currentBucket).toContainText(/Allocated\s*3/);
    await expect(currentBucket).toContainText(/Short\s*3/);
    await expect(competingBucket).toContainText(/Allocated\s*0/);
    await expect(competingBucket).toContainText(/Short\s*3/);

    await sheet.getByRole("button", { name: "Reset" }).click();
    await expect(currentBucket).toContainText(/Allocated\s*0/);
    await expect(currentBucket).toContainText(/Short\s*6/);

    await sheet.getByRole("button", { name: "Add MO" }).click();
    const createMoDialog = page.getByRole("dialog", {
      name: "Create Manufacturing Order",
    });
    await expect(createMoDialog).toBeVisible();
    await expect(createMoDialog).not.toContainText("Sales order not found");
    await expect(createMoDialog).toContainText(tokenMaterialName);
    await expect(
      createMoDialog.getByRole("textbox", {
        name: `Quantity for ${tokenMaterialName}`,
      })
    ).toHaveValue("6");
    await createMoDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(createMoDialog).toBeHidden();

    await stockStack.click();
    await currentBucket.click();
    await expect(currentBucket).toContainText(/Allocated\s*6/);
    await expect(currentBucket).toContainText(/Short\s*—/);

    const saveButton = page.getByRole("button", { name: "Save allocation" });
    await saveButton.click();
    await expect(page.getByRole("button", { name: "Saving..." })).toBeHidden({
      timeout: 15_000,
    });
    await expect(saveButton).toBeDisabled();

    const [line] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, tokenOrderId));
    const [competingLine] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, competingOrderId));
    const allocations = await db
      .select()
      .from(stockAllocations)
      .where(
        and(
          eq(stockAllocations.demandType, "sales_order_line"),
          eq(stockAllocations.demandId, line.id)
        )
      );
    expect(allocations).toHaveLength(1);
    expect(Number(allocations[0].quantity)).toBe(6);
    const competingAllocations = await db
      .select()
      .from(stockAllocations)
      .where(
        and(
          eq(stockAllocations.demandType, "sales_order_line"),
          eq(stockAllocations.demandId, competingLine.id)
        )
      );
    expect(competingAllocations).toHaveLength(0);
  });

  test("allocation read model bridges existing reservations and respects explicit zero", async ({
    db,
  }) => {
    const suffix = `${ts}-ALLOC-BRIDGE`;
    const customerResult = await createCustomer({
      name: `Fast Allocation Customer ${suffix}`,
      email: `fast-allocation-${suffix}@example.com`,
    });
    expect(customerResult.status).toBe(201);
    const allocationCustomerId = customerResult.body.id as string;

    const materialResult = await createItem({
      name: `Fast Allocation Material ${suffix}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-ALLOC-${suffix}`,
      category: `Fast Allocation ${suffix}`,
      description: "Material for allocation bridge coverage",
      defaultPurchasePrice: "1",
      defaultSellingPrice: "10",
      stock: "100",
      safetyStock: "0",
    });
    expect(materialResult.status).toBe(201);
    const allocationItemId = materialResult.body.id as string;

    const firstOrderResult = await createSalesOrder({
      customerId: allocationCustomerId,
      status: "confirmed",
      shipDate: "2026-05-15",
      confirmOversell: true,
      lines: [{ itemId: allocationItemId, quantity: "70", unitPrice: "10" }],
    });
    expect(firstOrderResult.status).toBe(201);
    const secondOrderResult = await createSalesOrder({
      customerId: allocationCustomerId,
      status: "confirmed",
      shipDate: "2026-05-16",
      confirmOversell: true,
      lines: [{ itemId: allocationItemId, quantity: "70", unitPrice: "10" }],
    });
    expect(secondOrderResult.status).toBe(201);

    const lines = await db
      .select({
        id: salesOrderLines.id,
        salesOrderId: salesOrderLines.salesOrderId,
        allocationManagedAt: salesOrderLines.allocationManagedAt,
      })
      .from(salesOrderLines)
      .where(
        inArray(salesOrderLines.salesOrderId, [
          firstOrderResult.body.id as string,
          secondOrderResult.body.id as string,
        ])
      )
      .orderBy(asc(salesOrderLines.createdAt));
    expect(lines).toHaveLength(2);
    expect(lines[0].allocationManagedAt).toBeNull();
    expect(lines[1].allocationManagedAt).toBeNull();

    const firstAllocationResponse = await testFetch(
      `/api/sales-order-lines/${lines[0].id}/allocation`
    );
    expect(firstAllocationResponse.status).toBe(200);
    const firstAllocation = await firstAllocationResponse.json();
    expect(firstAllocation.targetLine.allocatedQty).toBe("70");
    expect(firstAllocation.targetLine.shortQty).toBe("0");
    expect(firstAllocation.targetLine.sourceSummary).toBe("70 Stock");
    expect(firstAllocation.editableAllocations[0]).toMatchObject({
      sourceType: "stock_pool",
      quantity: "70",
      coverageKind: "implicit",
    });

    const secondAllocationResponse = await testFetch(
      `/api/sales-order-lines/${lines[1].id}/allocation`
    );
    expect(secondAllocationResponse.status).toBe(200);
    const secondAllocation = await secondAllocationResponse.json();
    expect(secondAllocation.targetLine.allocatedQty).toBe("30");
    expect(secondAllocation.targetLine.shortQty).toBe("40");

    const overAllocateResponse = await testFetch(
      `/api/sales-order-lines/${lines[0].id}/allocation`,
      {
        method: "PUT",
        body: JSON.stringify({
          allocations: [
            { sourceType: "stock_pool", sourceId: null, quantity: "80" },
          ],
        }),
      }
    );
    expect(overAllocateResponse.status).toBe(409);

    const zeroAllocationResponse = await testFetch(
      `/api/sales-order-lines/${lines[1].id}/allocation`,
      {
        method: "PUT",
        body: JSON.stringify({ allocations: [] }),
      }
    );
    expect(zeroAllocationResponse.status).toBe(200);

    const [managedLine] = await db
      .select({ allocationManagedAt: salesOrderLines.allocationManagedAt })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.id, lines[1].id));
    expect(managedLine.allocationManagedAt).not.toBeNull();

    const activeRows = await db
      .select()
      .from(stockAllocations)
      .where(
        and(
          eq(stockAllocations.demandType, "sales_order_line"),
          eq(stockAllocations.demandId, lines[1].id)
        )
      );
    expect(activeRows).toHaveLength(0);

    const zeroedAllocationResponse = await testFetch(
      `/api/sales-order-lines/${lines[1].id}/allocation`
    );
    expect(zeroedAllocationResponse.status).toBe(200);
    const zeroedAllocation = await zeroedAllocationResponse.json();
    expect(zeroedAllocation.targetLine.allocatedQty).toBe("0");
    expect(zeroedAllocation.targetLine.shortQty).toBe("70");
  });

  test("lot-aware allocation prevents shared stock double counting", async ({
    db,
  }) => {
    const suffix = `${ts}-LOT-DOUBLE`;
    const customerResult = await createCustomer({
      name: `Fast Lot Double Customer ${suffix}`,
    });
    expect(customerResult.status).toBe(201);

    const itemResult = await createItem({
      name: `Fast Lot Double Material ${suffix}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-LOT-DOUBLE-${suffix}`,
      category: `Fast Lot Double ${suffix}`,
      description: "Material for lot allocation double-count coverage",
      defaultPurchasePrice: "1",
      defaultSellingPrice: "10",
      stock: "10",
      safetyStock: "0",
    });
    expect(itemResult.status).toBe(201);

    const orderResult = await createSalesOrder({
      customerId: customerResult.body.id,
      status: "confirmed",
      shipDate: "2026-05-17",
      lines: [{ itemId: itemResult.body.id, quantity: "10", unitPrice: "10" }],
    });
    expect(orderResult.status).toBe(201);

    const [line] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, orderResult.body.id as string));

    const allocationResponse = await testFetch(
      `/api/sales-order-lines/${line.id}/allocation`
    );
    expect(allocationResponse.status).toBe(200);
    const allocationModel = await allocationResponse.json();
    const lotSource = allocationModel.supplySources.find(
      (source: { sourceType: string }) => source.sourceType === "lot"
    );
    expect(lotSource).toBeTruthy();

    const overAllocateResponse = await testFetch(
      `/api/sales-order-lines/${line.id}/allocation`,
      {
        method: "PUT",
        body: JSON.stringify({
          allocations: [
            {
              sourceType: "lot",
              sourceId: lotSource.sourceId,
              quantity: "10",
            },
            { sourceType: "stock_pool", sourceId: null, quantity: "10" },
          ],
        }),
      }
    );
    expect(overAllocateResponse.status).toBe(409);
  });

  test("mixed lot and stock-pool shipment consumes selected lots before FIFO", async ({
    db,
  }) => {
    const suffix = `${ts}-LOT-SHIP`;
    const customerResult = await createCustomer({
      name: `Fast Lot Ship Customer ${suffix}`,
    });
    expect(customerResult.status).toBe(201);

    const itemResult = await createItem({
      name: `Fast Lot Ship Material ${suffix}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-LOT-SHIP-${suffix}`,
      category: `Fast Lot Ship ${suffix}`,
      description: "Material for mixed lot and stock-pool shipping",
      defaultPurchasePrice: "1",
      defaultSellingPrice: "10",
      stock: "10",
      safetyStock: "0",
    });
    expect(itemResult.status).toBe(201);

    const orderResult = await createSalesOrder({
      customerId: customerResult.body.id,
      status: "confirmed",
      shipDate: "2026-05-18",
      lines: [{ itemId: itemResult.body.id, quantity: "10", unitPrice: "10" }],
    });
    expect(orderResult.status).toBe(201);

    const [line] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, orderResult.body.id as string));

    const allocationResponse = await testFetch(
      `/api/sales-order-lines/${line.id}/allocation`
    );
    expect(allocationResponse.status).toBe(200);
    const allocationModel = await allocationResponse.json();
    const lotSource = allocationModel.supplySources.find(
      (source: { sourceType: string }) => source.sourceType === "lot"
    );
    expect(lotSource).toBeTruthy();

    const lotAllocationResponse = await testFetch(
      `/api/sales-order-lines/${line.id}/allocation`,
      {
        method: "PUT",
        body: JSON.stringify({
          allocations: [
            {
              sourceType: "lot",
              sourceId: lotSource.sourceId,
              quantity: "5",
            },
            { sourceType: "stock_pool", sourceId: null, quantity: "5" },
          ],
        }),
      }
    );
    expect(lotAllocationResponse.status).toBe(200);

    const shipResult = await fulfillSalesOrder(orderResult.body.id as string);
    expect(shipResult.status).toBe(200);

    const [order] = await db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, orderResult.body.id as string));
    expect(order.status).toBe("shipped");
  });

  test("keeps same-date sales order rows in place after confirming from the list", async ({
    page,
    db,
  }) => {
    const orderingCustomerName = `Fast Same Date Customer ${ts}`;
    const customerResult = await createCustomer({
      name: orderingCustomerName,
      email: `fast-same-date-${ts}@example.com`,
    });
    expect(customerResult.status).toBe(201);
    const orderingCustomerId = customerResult.body.id as string;

    const materialResult = await createItem({
      name: `Fast Same Date Material ${ts}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-SAME-DATE-${ts}`,
      category: `Fast Same Date ${ts}`,
      description: "Material for sales order list sort stability",
      defaultPurchasePrice: "1",
      defaultSellingPrice: "5",
      stock: "20",
      safetyStock: "0",
    });
    expect(materialResult.status).toBe(201);
    const materialId = materialResult.body.id as string;

    const firstOrderResult = await createSalesOrder({
      customerId: orderingCustomerId,
      requestedDate: "2026-05-20",
      lines: [{ itemId: materialId, quantity: "1", unitPrice: "5" }],
    });
    const secondOrderResult = await createSalesOrder({
      customerId: orderingCustomerId,
      requestedDate: "2026-05-20",
      lines: [{ itemId: materialId, quantity: "1", unitPrice: "5" }],
    });
    expect(firstOrderResult.status).toBe(201);
    expect(secondOrderResult.status).toBe(201);

    const sameDateOrders = await db
      .select({
        orderNumber: salesOrders.orderNumber,
      })
      .from(salesOrders)
      .where(
        inArray(salesOrders.id, [
          firstOrderResult.body.id as string,
          secondOrderResult.body.id as string,
        ])
      )
      .orderBy(asc(salesOrders.orderNumber));
    expect(sameDateOrders).toHaveLength(2);
    const orderNumbers = sameDateOrders.map((order) => order.orderNumber);
    const [firstOrderNumber, secondOrderNumber] = orderNumbers;
    if (!firstOrderNumber || !secondOrderNumber) {
      throw new Error("Expected two same-date sales orders.");
    }

    await page.goto("/sales/orders");
    await filterList(page, "Search orders", orderingCustomerName);
    await expect(salesOrderCard(page, firstOrderNumber)).toBeVisible();
    await expect(salesOrderCard(page, secondOrderNumber)).toBeVisible();

    const getSameDatePositions = () =>
      page.locator('[data-testid="sales-order-card"]').evaluateAll(
        (cards, orderNumbers) =>
          (orderNumbers as string[]).map((orderNumber) =>
            cards.findIndex(
              (card) => card.getAttribute("data-order-number") === orderNumber
            )
          ),
        orderNumbers
      );

    const beforeConfirm = await getSameDatePositions();
    expect(beforeConfirm).toEqual([0, 1]);

    const confirmResponse = await testFetch(
      `/api/sales-orders/${firstOrderResult.body.id}/confirm`,
      {
        method: "POST",
        body: JSON.stringify({ confirmOversell: true }),
      }
    );
    expect(confirmResponse.status).toBe(200);

    await page.goto("/sales/orders");
    await filterList(page, "Search orders", orderingCustomerName);
    await expect(salesOrderCard(page, firstOrderNumber)).toBeVisible();
    await expect(salesOrderCard(page, secondOrderNumber)).toBeVisible();
  });

  test("confirming schedules a draft shipment and selected MOs stay separate", async ({
    db,
  }) => {
    const suffix = `${ts}-FULFILLMENT`;
    const materialResult = await createItem({
      name: `Fast Fulfillment Material ${suffix}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-FULFILL-MAT-${suffix}`,
      category: `Fast Fulfillment ${suffix}`,
      description: "Material for fulfillment planning",
      defaultPurchasePrice: "1",
      defaultSellingPrice: null,
      stock: "20",
      safetyStock: "0",
      bom: [],
    });
    expect(materialResult.status).toBe(201);
    const materialId = materialResult.body.id as string;

    const firstProductResult = await createItem({
      name: `Fast Fulfillment Product One ${suffix}`,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `FAST-FULFILL-P1-${suffix}`,
      category: `Fast Fulfillment ${suffix}`,
      description: "Selected fulfillment product",
      defaultPurchasePrice: null,
      defaultSellingPrice: "10",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: materialId, quantity: "1" }],
    });
    expect(firstProductResult.status).toBe(201);
    const firstProductId = firstProductResult.body.id as string;

    const secondProductResult = await createItem({
      name: `Fast Fulfillment Product Two ${suffix}`,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `FAST-FULFILL-P2-${suffix}`,
      category: `Fast Fulfillment ${suffix}`,
      description: "Unselected fulfillment product",
      defaultPurchasePrice: null,
      defaultSellingPrice: "10",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: materialId, quantity: "1" }],
    });
    expect(secondProductResult.status).toBe(201);
    const secondProductId = secondProductResult.body.id as string;

    const orderResult = await createSalesOrder({
      customerId,
      status: "confirmed",
      confirmOversell: true,
      shipDate: "2026-06-02",
      requestedDate: "2026-06-05",
      lines: [
        { itemId: firstProductId, quantity: "2", unitPrice: "10" },
        { itemId: secondProductId, quantity: "3", unitPrice: "10" },
      ],
    });
    expect(orderResult.status).toBe(201);
    const fulfillmentOrderId = orderResult.body.id as string;

    const orderLines = await db
      .select({
        id: salesOrderLines.id,
        itemId: salesOrderLines.itemId,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, fulfillmentOrderId));
    const lineByItemId = new Map(orderLines.map((line) => [line.itemId, line.id]));
    const selectedLineId = lineByItemId.get(firstProductId);
    const unselectedLineId = lineByItemId.get(secondProductId);
    expect(selectedLineId).toBeTruthy();
    expect(unselectedLineId).toBeTruthy();

    const createMoResponse = await testFetch(
      `/api/sales-orders/${fulfillmentOrderId}/manufacturing-orders`,
      {
        method: "POST",
        body: JSON.stringify({
          plannedDate: "2026-06-02",
          salesOrderLineIds: [selectedLineId],
          notes: null,
        }),
      }
    );
    expect(createMoResponse.status).toBe(201);

    const [plannedOrder] = await db
      .select({
        shipDate: salesOrders.shipDate,
        requestedDate: salesOrders.requestedDate,
      })
      .from(salesOrders)
      .where(eq(salesOrders.id, fulfillmentOrderId));
    expect(plannedOrder.shipDate).toBe("2026-06-02");
    expect(plannedOrder.requestedDate).toBe("2026-06-05");

    const shipments = await db
      .select({
        status: salesShipments.status,
        scheduledDate: salesShipments.scheduledDate,
      })
      .from(salesShipments)
      .where(eq(salesShipments.salesOrderId, fulfillmentOrderId));
    expect(shipments).toEqual([
      { status: "draft", scheduledDate: "2026-06-02" },
    ]);

    const createdManufacturingOrders = await db
      .select({
        salesOrderLineId: manufacturingOrders.salesOrderLineId,
        productId: manufacturingOrders.productId,
        plannedDate: manufacturingOrders.plannedDate,
      })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.salesOrderId, fulfillmentOrderId));
    expect(createdManufacturingOrders).toEqual([
      {
        salesOrderLineId: selectedLineId,
        productId: firstProductId,
        plannedDate: "2026-06-02",
      },
    ]);
  });

  test("potential honors BOM lot age constraints in inventory and sales detail", async ({
    db,
  }) => {
    const suffix = `${ts}-AGED-POTENTIAL`;
    const materialResult = await createItem({
      name: `Fast Aged Potential Material ${suffix}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-AGED-POT-MAT-${suffix}`,
      category: `Fast Aged Potential ${suffix}`,
      description: "Material for lot-age potential regression",
      defaultPurchasePrice: "1",
      defaultSellingPrice: null,
      stock: "10",
      safetyStock: "0",
      bom: [],
    });
    expect(materialResult.status).toBe(201);
    const materialId = materialResult.body.id as string;

    await db
      .update(lots)
      .set({ receivedAt: utcDateDaysFromToday(-1) })
      .where(eq(lots.itemId, materialId));
    await db
      .update(inventoryLotBalances)
      .set({ receivedAt: utcDateDaysFromToday(-1) })
      .where(eq(inventoryLotBalances.itemId, materialId));

    const productResult = await createItem({
      name: `Fast Aged Potential Product ${suffix}`,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `FAST-AGED-POT-PROD-${suffix}`,
      category: `Fast Aged Potential ${suffix}`,
      description: "Product with lot-age constrained BOM",
      defaultPurchasePrice: null,
      defaultSellingPrice: "10",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: materialId, quantity: "1", minimumLotAgeDays: 7 }],
    });
    expect(productResult.status).toBe(201);
    const constrainedProductId = productResult.body.id as string;

    const orderResult = await createSalesOrder({
      customerId,
      status: "draft",
      lines: [{ itemId: constrainedProductId, quantity: "1", unitPrice: "10" }],
    });
    expect(orderResult.status).toBe(201);
    const constrainedOrderId = orderResult.body.id as string;

    const productsResponse = await testFetch("/api/items?itemType=product&view=products");
    expect(productsResponse.status).toBe(200);
    const products = (await productsResponse.json()) as Array<{
      id: string;
      potential: string | null;
    }>;
    expect(products.find((product) => product.id === constrainedProductId)).toMatchObject({
      potential: "0",
    });

    const detailResponse = await testFetch(`/api/sales-orders/${constrainedOrderId}`);
    expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json();
    expect(detail.lines[0].potential).toBe("0");

    await db
      .update(lots)
      .set({ receivedAt: utcDateDaysFromToday(-8) })
      .where(eq(lots.itemId, materialId));
    await db
      .update(inventoryLotBalances)
      .set({ receivedAt: utcDateDaysFromToday(-8) })
      .where(eq(inventoryLotBalances.itemId, materialId));

    const agedProductsResponse = await testFetch(
      "/api/items?itemType=product&view=products"
    );
    expect(agedProductsResponse.status).toBe(200);
    const agedProducts = (await agedProductsResponse.json()) as Array<{
      id: string;
      potential: string | null;
    }>;
    expect(
      agedProducts.find((product) => product.id === constrainedProductId)
    ).toMatchObject({
      potential: "10",
    });

    const agedDetailResponse = await testFetch(
      `/api/sales-orders/${constrainedOrderId}`
    );
    expect(agedDetailResponse.status).toBe(200);
    const agedDetail = await agedDetailResponse.json();
    expect(agedDetail.lines[0].potential).toBe("10");
  });

  test("reports actual margin from FIFO lots with different costs", async ({ db }) => {
    const materialName = `Fast Margin Material ${ts}`;
    const materialResult = await createItem({
      name: materialName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-MARGIN-${ts}`,
      category: `Fast Sales ${ts}`,
      description: "Material for actual margin smoke test",
      defaultPurchasePrice: "10",
      defaultSellingPrice: "50",
      stock: "1",
      safetyStock: "0",
    });
    expect(materialResult.status).toBe(201);
    const materialId = materialResult.body.id as string;

    const supplierResult = await createSupplier({
      name: `Fast Margin Supplier ${ts}`,
      code: `FMS-${ts}`,
    });
    expect(supplierResult.status).toBe(201);

    const purchaseOrderResult = await createPurchaseOrder({
      supplierId: supplierResult.body.id,
      lines: [{ itemId: materialId, quantityOrdered: "1", unitCost: "20" }],
    });
    expect(purchaseOrderResult.status).toBe(201);
    const purchaseOrderId = purchaseOrderResult.body.id as string;

    const submitResult = await submitPurchaseOrder(purchaseOrderId);
    expect(submitResult.status).toBe(200);

    const [poLine] = await db
      .select({ id: purchaseOrderLines.id })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId));
    expect(poLine).toBeTruthy();

    const receiveResult = await receivePurchaseOrder(purchaseOrderId, {
      lines: [{ lineId: poLine.id, quantityReceived: "1" }],
    });
    expect(receiveResult.status).toBe(200);

    const orderResult = await createSalesOrder({
      customerId,
      status: "confirmed",
      confirmOversell: true,
      lines: [{ itemId: materialId, quantity: "2", unitPrice: "50" }],
    });
    expect(orderResult.status).toBe(201);
    const marginOrderId = orderResult.body.id as string;

    const shipResult = await fulfillSalesOrder(marginOrderId);
    expect(shipResult.status).toBe(200);

    const orderDetailResponse = await testFetch(`/api/sales-orders/${marginOrderId}`);
    expect(orderDetailResponse.status).toBe(200);
    const orderDetail = await orderDetailResponse.json();
    expect(orderDetail.lines[0].actualCogs).toBe("30");
    expect(orderDetail.lines[0].actualGrossProfit).toBe("70");
    expect(orderDetail.lines[0].actualMarginPercent).toBe("70");

    const lotsResponse = await testFetch(`/api/items/${materialId}/lots`);
    expect(lotsResponse.status).toBe(200);
    const marginLots = (await lotsResponse.json()) as Array<{
      costPerUnit: string | null;
      soldQuantity: string | null;
      realizedRevenue: string | null;
      realizedCogs: string | null;
      realizedMarginPercent: string | null;
    }>;
    const soldLots = marginLots
      .filter((lot) => lot.soldQuantity === "1")
      .sort((left, right) => Number(left.costPerUnit) - Number(right.costPerUnit));

    expect(soldLots).toHaveLength(2);
    expect(soldLots[0]).toMatchObject({
      costPerUnit: "10",
      realizedRevenue: "50",
      realizedCogs: "10",
      realizedMarginPercent: "80",
    });
    expect(soldLots[1]).toMatchObject({
      costPerUnit: "20",
      realizedRevenue: "50",
      realizedCogs: "20",
      realizedMarginPercent: "60",
    });
  });

  test("estimates margin from stocked subassembly cost before nested BOM cost", async () => {
    const suffix = `${ts}-SUB`;
    const materialResult = await createItem({
      name: `Fast Estimate Material ${suffix}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-EST-MAT-${suffix}`,
      category: `Fast Estimate ${suffix}`,
      description: "Material for nested estimated margin",
      defaultPurchasePrice: "5",
      defaultSellingPrice: null,
      stock: "1",
      safetyStock: "0",
      bom: [],
    });
    expect(materialResult.status).toBe(201);
    const materialId = materialResult.body.id as string;

    const subassemblyResult = await createItem({
      name: `Fast Estimate Subassembly ${suffix}`,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `FAST-EST-SUB-${suffix}`,
      category: `Fast Estimate ${suffix}`,
      description: "Stocked subassembly for nested estimated margin",
      defaultPurchasePrice: null,
      defaultSellingPrice: "12",
      stock: "1",
      safetyStock: "0",
      bom: [{ componentId: materialId, quantity: "1" }],
    });
    expect(subassemblyResult.status).toBe(201);
    const subassemblyId = subassemblyResult.body.id as string;

    const overrideCostResponse = await testFetch(
      `/api/items/${materialId}/current-stock-unit-cost`,
      {
        method: "PUT",
        body: JSON.stringify({ currentStockUnitCost: "10" }),
      },
    );
    expect(overrideCostResponse.status).toBe(200);

    const finishedResult = await createItem({
      name: `Fast Estimate Finished ${suffix}`,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `FAST-EST-FIN-${suffix}`,
      category: `Fast Estimate ${suffix}`,
      description: "Finished product using a stocked subassembly",
      defaultPurchasePrice: null,
      defaultSellingPrice: "20",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: subassemblyId, quantity: "1" }],
    });
    expect(finishedResult.status).toBe(201);
    const finishedId = finishedResult.body.id as string;

    const pricingResponse = await testFetch("/api/sales-orders/price", {
      method: "POST",
      body: JSON.stringify({
        customerId,
        itemId: finishedId,
        quantity: "1",
      }),
    });
    expect(pricingResponse.status).toBe(200);
    const pricing = await pricingResponse.json();
    expect(pricing.estimatedUnitCost).toBe("5");

    const productsResponse = await testFetch("/api/items?itemType=product&view=products");
    expect(productsResponse.status).toBe(200);
    const products = (await productsResponse.json()) as Array<{
      id: string;
      estimatedUnitCost: string | null;
      marginPercent: string | null;
    }>;
    const finishedProduct = products.find((product) => product.id === finishedId);
    expect(finishedProduct).toMatchObject({
      estimatedUnitCost: "5",
      marginPercent: "75",
    });
  });

  test("applies batch yield to estimated product margin", async () => {
    const suffix = `${ts}-BATCH-MARGIN`;
    const materialResult = await createItem({
      name: `Fast Batch Margin Material ${suffix}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-BATCH-MARGIN-MAT-${suffix}`,
      category: `Fast Batch Margin ${suffix}`,
      description: "Material for batch estimated margin",
      defaultPurchasePrice: "20",
      defaultSellingPrice: null,
      stock: "1",
      safetyStock: "0",
      bom: [],
    });
    expect(materialResult.status).toBe(201);
    const materialId = materialResult.body.id as string;

    const batchProductResult = await createItem({
      name: `Fast Batch Margin Product ${suffix}`,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `FAST-BATCH-MARGIN-PROD-${suffix}`,
      category: `Fast Batch Margin ${suffix}`,
      description: "Batch product for estimated margin",
      defaultPurchasePrice: null,
      defaultSellingPrice: "15",
      stock: "0",
      safetyStock: "0",
      manufacturingMode: "batch",
      expectedBatchYield: "4",
      bom: [{ componentId: materialId, quantity: "2" }],
    });
    expect(batchProductResult.status).toBe(201);
    const batchProductId = batchProductResult.body.id as string;

    const pricingResponse = await testFetch("/api/sales-orders/price", {
      method: "POST",
      body: JSON.stringify({
        customerId,
        itemId: batchProductId,
        quantity: "1",
      }),
    });
    expect(pricingResponse.status).toBe(200);
    const pricing = await pricingResponse.json();
    expect(pricing.estimatedUnitCost).toBe("10");

    const productsResponse = await testFetch("/api/items?itemType=product&view=products");
    expect(productsResponse.status).toBe(200);
    const products = (await productsResponse.json()) as Array<{
      id: string;
      estimatedUnitCost: string | null;
      marginPercent: string | null;
    }>;
    const batchProduct = products.find((product) => product.id === batchProductId);
    expect(batchProduct).toMatchObject({
      estimatedUnitCost: "10",
      marginPercent: "33.3",
    });
  });

  test("keeps Create MOs available when another line is already in production", async ({
    page,
  }) => {
    const suffix = `${ts}-PARTIAL-MO`;
    const materialResult = await createItem({
      name: `Fast Partial MO Material ${suffix}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-PARTIAL-MO-MAT-${suffix}`,
      category: `Fast Partial MO ${suffix}`,
      description: "Material for partially manufactured sales order",
      defaultPurchasePrice: "1",
      defaultSellingPrice: null,
      stock: "100",
      safetyStock: "0",
      bom: [],
    });
    expect(materialResult.status).toBe(201);
    const materialId = materialResult.body.id as string;

    const productOneResult = await createItem({
      name: `Fast Partial MO Product One ${suffix}`,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `FAST-PARTIAL-MO-P1-${suffix}`,
      category: `Fast Partial MO ${suffix}`,
      description: "First BOM-backed product",
      defaultPurchasePrice: null,
      defaultSellingPrice: "10",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: materialId, quantity: "1" }],
    });
    expect(productOneResult.status).toBe(201);
    const productOneId = productOneResult.body.id as string;

    const productTwoName = `Fast Partial MO Product Two ${suffix}`;
    const productTwoResult = await createItem({
      name: productTwoName,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `FAST-PARTIAL-MO-P2-${suffix}`,
      category: `Fast Partial MO ${suffix}`,
      description: "Second BOM-backed product",
      defaultPurchasePrice: null,
      defaultSellingPrice: "10",
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(productTwoResult.status).toBe(201);
    const productTwoId = productTwoResult.body.id as string;

    const orderResult = await createSalesOrder({
      customerId,
      status: "confirmed",
      confirmOversell: true,
      lines: [
        { itemId: productOneId, quantity: "1", unitPrice: "10" },
        { itemId: productTwoId, quantity: "1", unitPrice: "10" },
      ],
    });
    expect(orderResult.status).toBe(201);
    const partialMoOrderId = orderResult.body.id as string;

    const linkedMoPreview = await testFetch(
      `/api/sales-orders/${partialMoOrderId}/manufacturing-orders`
    );
    expect(linkedMoPreview.status).toBe(200);
    const linkedMoPreviewBody = await linkedMoPreview.json();
    const linkedMoLineIds = linkedMoPreviewBody.lines
      .filter((line: { status: string }) => line.status === "will_create")
      .map((line: { salesOrderLineId: string }) => line.salesOrderLineId);

    const linkedMoResult = await testFetch(
      `/api/sales-orders/${partialMoOrderId}/manufacturing-orders`,
      {
        method: "POST",
        body: JSON.stringify({
          plannedDate: null,
          salesOrderLineIds: linkedMoLineIds,
          notes: null,
        }),
      }
    );
    expect(linkedMoResult.status).toBe(201);
    const linkedMoBody = await linkedMoResult.json();
    expect(linkedMoBody.created).toHaveLength(1);

    const addBomResult = await updateItem(productTwoId, {
      name: productTwoName,
      purchaseUnitDefinitionId: null,
      purchaseToStockFactor: null,
      sku: `FAST-PARTIAL-MO-P2-${suffix}`,
      category: `Fast Partial MO ${suffix}`,
      defaultPurchasePrice: null,
      defaultSellingPrice: "10",
      sellable: true,
      description: "Second BOM-backed product",
      manufacturingMode: "discrete",
      expectedBatchYield: null,
      safetyStock: "0",
      bom: [{ componentId: materialId, quantity: "1" }],
      revisionNote: "Add BOM after first linked manufacturing order",
    });
    expect(addBomResult.status).toBe(200);

    await page.goto(`/sales/orders/${partialMoOrderId}`);
    await page.getByRole("button", { name: "Create MOs", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Create Manufacturing Orders" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(productTwoName);
    await expect(dialog).toContainText("1 order");
    await selectDate(page, dialog.getByLabel("Planned Date"), "2026-05-22");
    await expect(dialog.getByRole("button", { name: "Create 1 order" })).toBeEnabled();
  });

  test("hides Create MOs when finished goods stock covers the order", async ({
    page,
    db,
  }) => {
    const suffix = `${ts}-STOCK-MO`;
    const customerResult = await createCustomer({
      name: `Fast Stock Covers Customer ${suffix}`,
    });
    expect(customerResult.status).toBe(201);
    const stockedCustomerId = customerResult.body.id as string;

    const materialResult = await createItem({
      name: `Fast Stock Covers Material ${suffix}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-STOCK-MAT-${suffix}`,
      category: `Fast Stock Covers ${suffix}`,
      description: "Material for stocked finished goods",
      defaultPurchasePrice: "1",
      defaultSellingPrice: null,
      stock: "100",
      safetyStock: "0",
      bom: [],
    });
    expect(materialResult.status).toBe(201);
    const materialId = materialResult.body.id as string;

    const productName = `Fast Stock Covers Product ${suffix}`;
    const productResult = await createItem({
      name: productName,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `FAST-STOCK-PROD-${suffix}`,
      category: `Fast Stock Covers ${suffix}`,
      description: "BOM-backed product with enough finished goods stock",
      defaultPurchasePrice: null,
      defaultSellingPrice: "10",
      stock: "5",
      safetyStock: "0",
      bom: [{ componentId: materialId, quantity: "1" }],
    });
    expect(productResult.status).toBe(201);
    const stockedProductId = productResult.body.id as string;

    const draftOrderResult = await createSalesOrder({
      customerId: stockedCustomerId,
      status: "draft",
      lines: [{ itemId: stockedProductId, quantity: "4", unitPrice: "10" }],
    });
    expect(draftOrderResult.status).toBe(201);

    const orderResult = await createSalesOrder({
      customerId: stockedCustomerId,
      status: "confirmed",
      lines: [{ itemId: stockedProductId, quantity: "3", unitPrice: "10" }],
    });
    expect(orderResult.status).toBe(201);
    const stockedOrderId = orderResult.body.id as string;

    const previewResponse = await testFetch(
      `/api/sales-orders/${stockedOrderId}/manufacturing-orders`
    );
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json();
    expect(preview.hasManufacturableLines).toBe(false);
    expect(preview.lines).toMatchObject([
      {
        itemName: productName,
        status: "skipped",
        skipReason: "stock_on_hand",
      },
    ]);

    const oversellOrderResult = await createSalesOrder({
      customerId: stockedCustomerId,
      status: "confirmed",
      confirmOversell: true,
      lines: [{ itemId: stockedProductId, quantity: "4", unitPrice: "10" }],
    });
    expect(oversellOrderResult.status).toBe(201);
    const oversellOrderId = oversellOrderResult.body.id as string;

    const oversellPreviewResponse = await testFetch(
      `/api/sales-orders/${oversellOrderId}/manufacturing-orders`
    );
    expect(oversellPreviewResponse.status).toBe(200);
    const oversellPreview = await oversellPreviewResponse.json();
    expect(oversellPreview.hasManufacturableLines).toBe(true);
    expect(oversellPreview.lines).toMatchObject([
      {
        itemName: productName,
        quantity: "2",
        status: "will_create",
        skipReason: null,
      },
    ]);

    const listResponse = await testFetch("/api/sales-orders");
    expect(listResponse.status).toBe(200);
    const listRows = (await listResponse.json()) as Array<{
      id: string;
      hasManufacturableLines: boolean;
      manufacturableLineCount: number;
    }>;
    expect(listRows.find((row) => row.id === stockedOrderId)).toMatchObject({
      hasManufacturableLines: false,
      manufacturableLineCount: 0,
    });
    expect(listRows.find((row) => row.id === oversellOrderId)).toMatchObject({
      hasManufacturableLines: true,
      manufacturableLineCount: 1,
    });

    const [order] = await db
      .select({ orderNumber: salesOrders.orderNumber })
      .from(salesOrders)
      .where(eq(salesOrders.id, stockedOrderId));

    await page.goto("/sales/orders");
    await showSalesOrderStatus(page, "Confirmed");
    await filterList(page, "Search orders", order.orderNumber);

    const orderCard = salesOrderCard(page, order.orderNumber);
    await expect(orderCard.getByRole("button", { name: "Create MOs" })).toHaveCount(0);
  });

  test("ships a draft shipment from sales order detail", async ({ page, db }) => {
    const suffix = `${ts}-WS`;
    const customerResult = await createCustomer({
      name: `Fast Web Ship Customer ${suffix}`,
    });
    expect(customerResult.status).toBe(201);
    const webShipCustomerId = customerResult.body.id as string;

    const materialResult = await createItem({
      name: `Fast Web Ship Material ${suffix}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-WS-MAT-${suffix}`,
      category: `Fast Web Ship ${suffix}`,
      description: "Material for stocked web shipment product",
      defaultPurchasePrice: "1",
      defaultSellingPrice: null,
      stock: "20",
      safetyStock: "0",
      bom: [],
    });
    expect(materialResult.status).toBe(201);
    const webShipMaterialId = materialResult.body.id as string;

    const productResult = await createItem({
      name: `Fast Web Ship Product ${suffix}`,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `FAST-WS-${suffix}`,
      category: `Fast Web Ship ${suffix}`,
      description: "Stocked product for web shipment action",
      defaultPurchasePrice: null,
      defaultSellingPrice: "10",
      stock: "5",
      safetyStock: "0",
      bom: [{ componentId: webShipMaterialId, quantity: "1" }],
    });
    expect(productResult.status).toBe(201);
    const webShipProductId = productResult.body.id as string;

    const orderResult = await createSalesOrder({
      customerId: webShipCustomerId,
      status: "confirmed",
      lines: [{ itemId: webShipProductId, quantity: "2", unitPrice: "10" }],
    });
    expect(orderResult.status).toBe(201);
    const webShipOrderId = orderResult.body.id as string;

    await page.goto(`/sales/orders/${webShipOrderId}`);
    const shipmentRow = page.getByRole("row", { name: /Draft/ });
    await shipmentRow.getByRole("button", { name: "Ship", exact: true }).click();

    const dialog = page.getByRole("alertdialog", { name: "Ship this shipment?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Ship Shipment" }).click();
    await expect(page.getByRole("dialog", { name: "Shipment Complete" })).toBeVisible({
      timeout: 15_000,
    });

    const [shippedOrder] = await db
      .select({ status: salesOrders.status, shippedAt: salesOrders.shippedAt })
      .from(salesOrders)
      .where(eq(salesOrders.id, webShipOrderId));
    expect(shippedOrder.status).toBe("shipped");
    expect(shippedOrder.shippedAt).not.toBeNull();

    const [shippedShipment] = await db
      .select({ status: salesShipments.status, shippedAt: salesShipments.shippedAt })
      .from(salesShipments)
      .where(eq(salesShipments.salesOrderId, webShipOrderId));
    expect(shippedShipment.status).toBe("shipped");
    expect(shippedShipment.shippedAt).not.toBeNull();
  });

  test("plans a draft shipment before stock is allocated", async ({ db }) => {
    const suffix = `${ts}-DRAFT-SHORT`;
    const customerResult = await createCustomer({
      name: `Fast Draft Short Customer ${suffix}`,
    });
    expect(customerResult.status).toBe(201);

    const itemResult = await createItem({
      name: `Fast Draft Short Material ${suffix}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-DRAFT-SHORT-${suffix}`,
      category: `Fast Draft Short ${suffix}`,
      description: "Material for draft shipment planning without allocation",
      defaultPurchasePrice: "1",
      defaultSellingPrice: "10",
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(itemResult.status).toBe(201);

    const orderResponse = await testFetch("/api/sales-orders", {
      method: "POST",
      body: JSON.stringify({
        customerId: customerResult.body.id,
        status: "draft",
        orderDate: "2026-04-23",
        shipDate: "2026-04-23",
        requestedDate: "2026-04-23",
        notes: "Draft shipment before allocation",
        lines: [
          {
            itemId: itemResult.body.id,
            quantity: "8",
            unitPrice: "10",
          },
        ],
      }),
    });
    expect(orderResponse.status).toBe(201);
    const orderBody = await orderResponse.json();
    const shortOrderId = orderBody.id as string;

    const confirmResponse = await confirmSalesOrder(shortOrderId, {
      confirmOversell: true,
    });
    expect(confirmResponse.status).toBe(200);

    const [line] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, shortOrderId));

    const [initialDraftShipment] = await db
      .select({ id: salesShipments.id })
      .from(salesShipments)
      .where(eq(salesShipments.salesOrderId, shortOrderId));
    if (!initialDraftShipment) {
      throw new Error("Expected confirmation to create a draft shipment.");
    }

    const splitExistingResponse = await testFetch(
      `/api/sales-orders/${shortOrderId}/shipments/${initialDraftShipment.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          fulfillmentType: "delivery",
          scheduledDate: "2026-04-23",
          notes: "First split, allocate later",
          lines: [{ salesOrderLineId: line.id, quantity: "4" }],
        }),
      }
    );
    expect(splitExistingResponse.status).toBe(200);

    const planResponse = await testFetch(
      `/api/sales-orders/${shortOrderId}/shipments`,
      {
        method: "POST",
        body: JSON.stringify({
          fulfillmentType: "delivery",
          scheduledDate: "2026-04-23",
          notes: "Plan now, allocate later",
          lines: [{ salesOrderLineId: line.id, quantity: "4" }],
        }),
      }
    );
    expect(planResponse.status).toBe(201);
    const plannedShipment = await planResponse.json();

    const [plannedLine] = await db
      .select({ quantity: salesShipmentLines.quantity })
      .from(salesShipmentLines)
      .where(eq(salesShipmentLines.salesShipmentId, plannedShipment.id));
    expect(plannedLine.quantity).toBe("4.0000");

    const shipResponse = await testFetch(
      `/api/sales-orders/${shortOrderId}/shipments/${plannedShipment.id}/ship`,
      { method: "POST" }
    );
    expect(shipResponse.status).toBe(409);
  });
});
