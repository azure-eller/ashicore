import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Page } from "@playwright/test";
import { test, expect, filterList, getIdFromUrl, selectDate } from "../fixtures";
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
  createManufacturingOrder,
  fulfillSalesOrder,
  getOrgId,
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
  const workflow = ["Shipped", "Cancelled"].includes(status) ? "done" : "open";
  await page.getByRole("radio", { name: `Show ${workflow} orders` }).click();
}

function salesOrderRow(page: Page, orderNumber: string) {
  return page.getByRole("row").filter({ hasText: orderNumber }).first();
}

function salesOrderCard(page: Page, orderNumber: string) {
  return salesOrderRow(page, orderNumber);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function openAllocationManagerFromMatrix(params: {
  page: Page;
  orderNumber: string;
  itemName: string;
}) {
  const { page, orderNumber, itemName } = params;
  await page.goto("/sales/allocation");
  await page.getByLabel("Search sales allocations").fill(orderNumber);
  await expect(page.getByText("Coverage").first()).toBeVisible();
  await page.getByText("Coverage").first().click();
  await expect(page.getByRole("dialog", { name: /Allocate/ })).toHaveCount(0);

  const allocateButton = page
    .getByRole("button", { name: new RegExp(`^Allocate ${escapeRegExp(itemName)}$`) })
    .first();
  await expect(allocateButton).toBeVisible();
  await allocateButton.click();

  const sheet = page.getByRole("dialog", {
    name: new RegExp(`Allocate ${escapeRegExp(itemName)}`),
  });
  await expect(sheet).toBeVisible();
  return sheet;
}

async function getSalesOrderNumber(orderId: string) {
  const response = await testFetch(`/api/sales-orders/${orderId}`);
  expect(response.status).toBe(200);
  const body = await response.json();
  return body.orderNumber as string;
}

async function getSalesAllocationWorkspace(
  lineId: string,
  itemId: string,
  demandType: "sales_order_line" | "sales_shipment_line" = "sales_order_line"
) {
  const response = await testFetch(
    `/api/allocation/workspace?demandType=${demandType}&demandId=${lineId}&itemId=${itemId}`
  );
  const body = await response.json();
  return { response, body };
}

async function saveSalesAllocation(params: {
  demandType?: "sales_order_line" | "sales_shipment_line";
  lineId: string;
  itemId: string;
  allocations: Array<{
    sourceType: "inventory_lot" | "manufacturing_order";
    sourceId: string;
    quantity: string;
  }>;
}) {
  const response = await testFetch("/api/allocation/save", {
    method: "POST",
    body: JSON.stringify({
      demandType: params.demandType ?? "sales_order_line",
      demandId: params.lineId,
      itemId: params.itemId,
      allocations: params.allocations,
    }),
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

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
    await page.getByLabel("Priority").click();
    await page.getByRole("option", { name: "High" }).click();
    await page.getByLabel("Account State").click();
    await page.getByRole("option", { name: "Growth" }).click();
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
    expect(customer.accountPriority).toBe("high");
    expect(customer.accountState).toBe("growth");
    expect(customer.billingLine1).toBe("100 Market Street");
    expect(customer.notes).toBe("Fast customer smoke test");

    await page.getByRole("link", { name: "Edit", exact: true }).click();
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

  test("creates an open sales order through the browser form", async ({ page, db }) => {
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
    await page.getByLabel("Project / Job").click();
    await page.getByRole("option", { name: new RegExp(`Example Construction ${ts}`) }).click();

    await selectDate(page, page.getByLabel("Order Date"), "2026-04-01");
    await selectDate(page, page.getByLabel("Ship Date"), "2026-04-15");
    await selectDate(page, page.getByLabel("Delivery Date"), "2026-04-15");

    const itemInput = page.getByPlaceholder("Search items...").first();
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
    expect(order.customerProjectId).toBe(crmProjectId);
    expect(order.customerName).toBe(customerName);
    expect(order.status).toBe("open");
    expect(order.orderDate).toBe("2026-04-01");
    expect(order.shipDate).toBe("2026-04-15");
    expect(order.requestedDate).toBe("2026-04-15");
    expect(order.notes).toBe(orderNote);

    await page.goto("/sales/orders");
    await showSalesOrderStatus(page, "Confirmed");
    await filterList(page, "Search orders", order.orderNumber);
    const listRow = salesOrderCard(page, order.orderNumber);
    await expect(
      listRow.getByRole("link", { name: order.orderNumber })
    ).toHaveAttribute("href", `/sales/orders/${orderId}`);
    await expect(listRow).toContainText(customerName);
    await expect(listRow.getByRole("link", { name: customerName })).toHaveCount(0);
    await listRow.getByRole("button", { name: orderNote }).hover();
    await expect(page.getByRole("tooltip")).toContainText(orderNote);

    await page.goto(`/sales/orders/${orderId}`);
    await expect(
      page.getByRole("heading", { level: 1, name: order.orderNumber })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: customerName })).toBeVisible();
    await expect(page.getByRole("link", { name: `Example Construction ${ts}` })).toBeVisible();

    await page.goto(`/sales/customers/${customerId}?project=${crmProjectId}#projects`);
    await expect(page.getByRole("button", { name: /^Projects/ })).toHaveAttribute(
      "aria-current",
      "page"
    );
    await page.getByRole("button", { name: new RegExp(`Example Construction ${ts}`) }).click();
    await expect(page.getByRole("link", { name: order.orderNumber })).toBeVisible();

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
    expect(productBalance?.committedQty ?? "0.0000").toBe("3.0000");

    await page.goto(`/sales/orders/${orderId}`);
    await expect(page.getByText("Confirm the order before shipping.")).toHaveCount(0);
    await expect(page.getByText("Failed to confirm order.")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create invoice" }).first()).toBeVisible();

    const shipments = await db
      .select()
      .from(salesShipments)
      .where(eq(salesShipments.salesOrderId, orderId));
    expect(shipments).toHaveLength(1);
    expect(shipments[0].scheduledDate).toBe("2026-04-15");
  });

  test("creating without a delivery date returns a readable error", async () => {
    const createResponse = await testFetch("/api/sales-orders", {
      method: "POST",
      body: JSON.stringify({
        customerId,
        status: "open",
        orderDate: "2026-04-01",
        shipDate: null,
        requestedDate: null,
        notes: null,
        lines: [{ itemId: productId, quantity: "1", unitPrice: "34.99" }],
      }),
    });
    expect(createResponse.status).toBe(400);
    const body = await createResponse.json();
    expect(body.error).toBe("Ship date is required to create a sales order");
    expect(body.errors.shipDate[0]).toBe(
      "Ship date is required to create a sales order"
    );
  });

  test("creating without line items returns a readable error", async () => {
    const createResponse = await testFetch("/api/sales-orders", {
      method: "POST",
      body: JSON.stringify({
        customerId,
        status: "open",
        orderDate: "2026-04-01",
        shipDate: null,
        requestedDate: null,
        notes: null,
        lines: [],
      }),
    });
    expect(createResponse.status).toBe(400);
    const body = await createResponse.json();
    expect(body.error).toBe("Sales order must have at least one line item");
  });

  test("saving a ship date before the order date returns a readable error", async () => {
    const createResponse = await testFetch("/api/sales-orders", {
      method: "POST",
      body: JSON.stringify({
        customerId,
        status: "open",
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
    expect(duplicate.status).toBe("open");
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

  test("removes line items from detail view", async ({
    page,
    db,
  }) => {
    const firstProductName = `Fast Detail Delete Product ${ts}`;
    const secondProductName = `Fast Detail Keep Product ${ts}`;

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
      status: "open",
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
    await page.getByRole("button", { name: /^Line Items/ }).click();
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

    const detailLines = await db
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, detailOrderId))
      .orderBy(asc(salesOrderLines.sortOrder));
    expect(detailLines).toHaveLength(1);
    expect(detailLines[0].itemId).toBe(detailKeepId);
  });

  test("edits an open unshipped order and refreshes reservations", async ({
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
      status: "open",
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
    await page.getByRole("link", { name: "Edit", exact: true }).click();
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
    expect(orderAfterEdit.status).toBe("open");
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

    const [plannedShipmentLine] = await db
      .select({ quantity: salesShipmentLines.quantity })
      .from(salesShipmentLines)
      .innerJoin(
        salesShipments,
        eq(salesShipmentLines.salesShipmentId, salesShipments.id)
      )
      .where(eq(salesShipments.salesOrderId, editOrderId));
    expect(plannedShipmentLine.quantity).toBe("4.0000");
  });

  test("allocation manager does not count unallocated available stock as allocated", async ({
    page,
  }) => {
    const reservedCustomerResult = await createCustomer({
      name: `Fast Reserved Stock Customer ${ts}`,
      email: `fast-reserved-stock-${ts}@example.com`,
    });
    expect(reservedCustomerResult.status).toBe(201);
    const reservedCustomerId = reservedCustomerResult.body.id as string;
    const componentResult = await createItem({
      name: `Fast Reserved Stock Component ${ts}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-RESERVED-COMP-${ts}`,
      category: `Fast Sales ${ts}`,
      description: "Component for allocation availability label regression",
      defaultPurchasePrice: "1",
      defaultSellingPrice: null,
      stock: "150",
      safetyStock: "0",
    });
    expect(componentResult.status).toBe(201);
    const componentId = componentResult.body.id as string;
    const materialName = `Fast Reserved Stock Label ${ts}`;
    const materialSku = `FAST-RESERVED-STOCK-${ts}`;
    const materialResult = await createItem({
      name: materialName,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: materialSku,
      category: `Fast Sales ${ts}`,
      description: "Product for allocation availability label regression",
      defaultPurchasePrice: null,
      defaultSellingPrice: "10",
      stock: "150",
      safetyStock: "0",
      bom: [{ componentId, quantity: "1" }],
    });
    expect(materialResult.status).toBe(201);
    const materialId = materialResult.body.id as string;

    const orderResult = await createSalesOrder({
      customerId: reservedCustomerId,
      status: "open",
      confirmOversell: true,
      lines: [{ itemId: materialId, quantity: "150", unitPrice: "10" }],
    });
    expect(orderResult.status).toBe(201);
    const reservedOrderId = orderResult.body.id as string;
    const reservedOrderNumber = await getSalesOrderNumber(reservedOrderId);

    const sheet = await openAllocationManagerFromMatrix({
      page,
      orderNumber: reservedOrderNumber,
      itemName: materialName,
    });
    await expect(sheet.getByText("Need")).toBeVisible();
    await expect(sheet.getByText("Allocated")).toBeVisible();
    await expect(sheet.getByText("-150 short")).toBeVisible();
    await expect(sheet.getByText("150", { exact: true }).first()).toBeVisible();
    await expect(sheet.getByText(/^0$/).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });

  test("allocation matrix saves an inventory allocation", async ({ page, db }) => {
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
      status: "open",
      lines: [{ itemId: tokenMaterialId, quantity: "6", unitPrice: "10" }],
    });
    expect(tokenOrderResult.status).toBe(201);
    const tokenOrderId = tokenOrderResult.body.id as string;
    const competingOrderResult = await createSalesOrder({
      customerId: tokenCustomerId,
      status: "open",
      shipDate: "2026-05-12",
      lines: [{ itemId: tokenMaterialId, quantity: "3", unitPrice: "10" }],
    });
    expect(competingOrderResult.status).toBe(201);
    const tokenOrderNumber = await getSalesOrderNumber(tokenOrderId);

    const sheet = await openAllocationManagerFromMatrix({
      page,
      orderNumber: tokenOrderNumber,
      itemName: tokenMaterialName,
    });
    await expect(sheet.getByRole("heading", { name: "Sources" })).toBeVisible();

    const sourceInput = sheet
      .getByRole("spinbutton", { name: /Allocate quantity for LOT-/ })
      .first();
    await expect(sourceInput).toBeVisible();
    await sourceInput.fill("6");

    await expect(sourceInput).toHaveValue("6");
    await expect(sheet.getByText("✓ complete")).toBeVisible();

    const saveButton = sheet.getByRole("button", { name: "Save allocation" });
    await saveButton.click();
    await expect(page.getByRole("button", { name: "Saving..." })).toBeHidden({
      timeout: 15_000,
    });
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    const detailResponse = await testFetch(`/api/sales-orders/${tokenOrderId}`);
    expect(detailResponse.status).toBe(200);
    const detailBody = await detailResponse.json();
    const line = detailBody.lines[0];
    expect(line.allocatedQty).toBe("6");

    const [shipmentLine] = await db
      .select({ id: salesShipmentLines.id })
      .from(salesShipmentLines)
      .where(eq(salesShipmentLines.salesOrderLineId, line.id));
    expect(shipmentLine).toBeTruthy();

    const allocationRows = await db
      .select({
        sourceType: stockAllocations.sourceType,
        quantity: stockAllocations.quantity,
      })
      .from(stockAllocations)
      .where(
        and(
          eq(stockAllocations.demandType, "sales_shipment_line"),
          eq(stockAllocations.demandId, shipmentLine.id),
          eq(stockAllocations.status, "active")
        )
      );
    expect(allocationRows).toMatchObject([
      {
        sourceType: "inventory_lot",
        quantity: "6.0000",
      },
    ]);
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
    const [allocationLot] = await db
      .select({ id: lots.id, lotNumber: lots.lotNumber })
      .from(lots)
      .where(eq(lots.itemId, allocationItemId));
    expect(allocationLot).toBeTruthy();

    const firstOrderResult = await createSalesOrder({
      customerId: allocationCustomerId,
      status: "open",
      shipDate: "2026-05-15",
      confirmOversell: true,
      lines: [{ itemId: allocationItemId, quantity: "70", unitPrice: "10" }],
    });
    expect(firstOrderResult.status).toBe(201);
    const secondOrderResult = await createSalesOrder({
      customerId: allocationCustomerId,
      status: "open",
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

    const { response: firstAllocationResponse, body: firstAllocation } =
      await getSalesAllocationWorkspace(lines[0].id, allocationItemId);
    expect(firstAllocationResponse.status).toBe(200);
    expect(firstAllocation.primaryDemand.allocatedQty).toBe("0");
    expect(firstAllocation.primaryDemand.shortQty).toBe("70");
    const firstLotSource = firstAllocation.sources.find(
      (source: { sourceType: string }) => source.sourceType === "inventory_lot"
    );
    expect(firstLotSource).toBeTruthy();

    const { response: secondAllocationResponse, body: secondAllocation } =
      await getSalesAllocationWorkspace(lines[1].id, allocationItemId);
    expect(secondAllocationResponse.status).toBe(200);
    expect(secondAllocation.primaryDemand.allocatedQty).toBe("0");
    expect(secondAllocation.primaryDemand.shortQty).toBe("70");

    const { response: overAllocateResponse } = await saveSalesAllocation({
      lineId: lines[0].id,
      itemId: allocationItemId,
      allocations: [
        {
          sourceType: "inventory_lot",
          sourceId: firstLotSource.sourceId,
          quantity: "80",
        },
      ],
    });
    expect(overAllocateResponse.status).toBe(409);

    const { response: zeroAllocationResponse } = await saveSalesAllocation({
      lineId: lines[1].id,
      itemId: allocationItemId,
      allocations: [],
    });
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

    const { response: zeroedAllocationResponse, body: zeroedAllocation } =
      await getSalesAllocationWorkspace(lines[1].id, allocationItemId);
    expect(zeroedAllocationResponse.status).toBe(200);
    expect(zeroedAllocation.primaryDemand.allocatedQty).toBe("0");
    expect(zeroedAllocation.primaryDemand.shortQty).toBe("70");
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
      status: "open",
      shipDate: "2026-05-17",
      lines: [{ itemId: itemResult.body.id, quantity: "10", unitPrice: "10" }],
    });
    expect(orderResult.status).toBe(201);

    const [line] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, orderResult.body.id as string));

    const { response: allocationResponse, body: allocationModel } =
      await getSalesAllocationWorkspace(line.id, itemResult.body.id as string);
    expect(allocationResponse.status).toBe(200);
    const lotSource = allocationModel.sources.find(
      (source: { sourceType: string }) => source.sourceType === "inventory_lot"
    );
    expect(lotSource).toBeTruthy();

    const { response: overAllocateResponse } = await saveSalesAllocation({
      lineId: line.id,
      itemId: itemResult.body.id as string,
      allocations: [
        {
          sourceType: "inventory_lot",
          sourceId: lotSource.sourceId,
          quantity: "11",
        },
      ],
    });
    expect(overAllocateResponse.status).toBe(409);
  });

  test("lot allocation shipment consumes selected lots before FIFO", async ({
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
      description: "Material for selected lot shipping",
      defaultPurchasePrice: "1",
      defaultSellingPrice: "10",
      stock: "10",
      safetyStock: "0",
    });
    expect(itemResult.status).toBe(201);

    const orderResult = await createSalesOrder({
      customerId: customerResult.body.id,
      status: "open",
      shipDate: "2026-05-18",
      lines: [{ itemId: itemResult.body.id, quantity: "10", unitPrice: "10" }],
    });
    expect(orderResult.status).toBe(201);

    const [line] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, orderResult.body.id as string));

    const { response: allocationResponse, body: allocationModel } =
      await getSalesAllocationWorkspace(line.id, itemResult.body.id as string);
    expect(allocationResponse.status).toBe(200);
    const lotSource = allocationModel.sources.find(
      (source: { sourceType: string }) => source.sourceType === "inventory_lot"
    );
    expect(lotSource).toBeTruthy();

    const { response: lotAllocationResponse } = await saveSalesAllocation({
      lineId: line.id,
      itemId: itemResult.body.id as string,
      allocations: [
        {
          sourceType: "inventory_lot",
          sourceId: lotSource.sourceId,
          quantity: "10",
        },
      ],
    });
    expect(lotAllocationResponse.status).toBe(200);

    const shipResult = await fulfillSalesOrder(orderResult.body.id as string);
    expect(shipResult.status).toBe(200);

    const [order] = await db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, orderResult.body.id as string));
    expect(order.status).toBe("done");
  });

  test("planned shipment edits preserve unchanged shipment-line allocations", async ({
    db,
  }) => {
    const suffix = `${ts}-SHIP-EDIT-PRESERVE`;
    const customerResult = await createCustomer({
      name: `Fast Shipment Preserve Customer ${suffix}`,
    });
    expect(customerResult.status).toBe(201);

    const itemResult = await createItem({
      name: `Fast Shipment Preserve Material ${suffix}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FSEP-${ts}`,
      category: `Fast Shipment Preserve ${suffix}`,
      description: "Material for shipment allocation preservation",
      defaultPurchasePrice: "1",
      defaultSellingPrice: "10",
      stock: "10",
      safetyStock: "0",
    });
    expect(itemResult.status).toBe(201);

    const orderResult = await createSalesOrder({
      customerId: customerResult.body.id,
      status: "open",
      shipDate: "2026-05-20",
      lines: [{ itemId: itemResult.body.id, quantity: "6", unitPrice: "10" }],
    });
    expect(orderResult.status).toBe(201);

    const [shipmentLine] = await db
      .select({
        id: salesShipmentLines.id,
        salesOrderLineId: salesShipmentLines.salesOrderLineId,
        shipmentId: salesShipmentLines.salesShipmentId,
      })
      .from(salesShipmentLines)
      .innerJoin(
        salesShipments,
        eq(salesShipmentLines.salesShipmentId, salesShipments.id)
      )
      .where(eq(salesShipments.salesOrderId, orderResult.body.id as string));
    expect(shipmentLine).toBeTruthy();

    const { response: workspaceResponse, body: allocationModel } =
      await getSalesAllocationWorkspace(
        shipmentLine.id,
        itemResult.body.id as string,
        "sales_shipment_line"
      );
    expect(workspaceResponse.status).toBe(200);
    const lotSource = allocationModel.sources.find(
      (source: { sourceType: string }) => source.sourceType === "inventory_lot"
    );
    expect(lotSource).toBeTruthy();

    const { response: saveResponse } = await saveSalesAllocation({
      demandType: "sales_shipment_line",
      lineId: shipmentLine.id,
      itemId: itemResult.body.id as string,
      allocations: [
        {
          sourceType: "inventory_lot",
          sourceId: lotSource.sourceId,
          quantity: "4",
        },
      ],
    });
    expect(saveResponse.status).toBe(200);

    const editResponse = await testFetch(
      `/api/sales-orders/${orderResult.body.id}/shipments/${shipmentLine.shipmentId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          fulfillmentType: "delivery",
          scheduledDate: "2026-05-21",
          notes: "Date changed, allocation should stay",
          lines: [{ salesOrderLineId: shipmentLine.salesOrderLineId, quantity: "6" }],
        }),
      }
    );
    expect(editResponse.status).toBe(200);

    const [editedShipment] = await db
      .select({
        scheduledDate: salesShipments.scheduledDate,
        notes: salesShipments.notes,
      })
      .from(salesShipments)
      .where(eq(salesShipments.id, shipmentLine.shipmentId));
    expect(editedShipment).toEqual({
      scheduledDate: "2026-05-21",
      notes: "Date changed, allocation should stay",
    });

    const [preservedLine] = await db
      .select({
        id: salesShipmentLines.id,
        quantity: salesShipmentLines.quantity,
      })
      .from(salesShipmentLines)
      .where(eq(salesShipmentLines.salesShipmentId, shipmentLine.shipmentId));
    expect(preservedLine.id).toBe(shipmentLine.id);
    expect(preservedLine.quantity).toBe("6.0000");

    const activeAllocations = await db
      .select({
        demandId: stockAllocations.demandId,
        quantity: stockAllocations.quantity,
        status: stockAllocations.status,
      })
      .from(stockAllocations)
      .where(
        and(
          eq(stockAllocations.demandType, "sales_shipment_line"),
          eq(stockAllocations.demandId, shipmentLine.id)
        )
      );
    expect(activeAllocations).toEqual([
      {
        demandId: shipmentLine.id,
        quantity: "4.0000",
        status: "active",
      },
    ]);
  });

  test("decreasing a planned shipment line releases only excess allocation", async ({
    db,
  }) => {
    const suffix = `${ts}-SHIP-EDIT-CLAMP`;
    const customerResult = await createCustomer({
      name: `Fast Shipment Clamp Customer ${suffix}`,
    });
    expect(customerResult.status).toBe(201);

    const itemResult = await createItem({
      name: `Fast Shipment Clamp Material ${suffix}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FSEC-${ts}`,
      category: `Fast Shipment Clamp ${suffix}`,
      description: "Material for shipment allocation clamp",
      defaultPurchasePrice: "1",
      defaultSellingPrice: "10",
      stock: "10",
      safetyStock: "0",
    });
    expect(itemResult.status).toBe(201);

    const orderResult = await createSalesOrder({
      customerId: customerResult.body.id,
      status: "open",
      shipDate: "2026-05-22",
      lines: [{ itemId: itemResult.body.id, quantity: "6", unitPrice: "10" }],
    });
    expect(orderResult.status).toBe(201);

    const [shipmentLine] = await db
      .select({
        id: salesShipmentLines.id,
        salesOrderLineId: salesShipmentLines.salesOrderLineId,
        shipmentId: salesShipmentLines.salesShipmentId,
      })
      .from(salesShipmentLines)
      .innerJoin(
        salesShipments,
        eq(salesShipmentLines.salesShipmentId, salesShipments.id)
      )
      .where(eq(salesShipments.salesOrderId, orderResult.body.id as string));
    expect(shipmentLine).toBeTruthy();

    const { response: workspaceResponse, body: allocationModel } =
      await getSalesAllocationWorkspace(
        shipmentLine.id,
        itemResult.body.id as string,
        "sales_shipment_line"
      );
    expect(workspaceResponse.status).toBe(200);
    const lotSource = allocationModel.sources.find(
      (source: { sourceType: string }) => source.sourceType === "inventory_lot"
    );
    expect(lotSource).toBeTruthy();

    const { response: saveResponse } = await saveSalesAllocation({
      demandType: "sales_shipment_line",
      lineId: shipmentLine.id,
      itemId: itemResult.body.id as string,
      allocations: [
        {
          sourceType: "inventory_lot",
          sourceId: lotSource.sourceId,
          quantity: "6",
        },
      ],
    });
    expect(saveResponse.status).toBe(200);

    const editResponse = await testFetch(
      `/api/sales-orders/${orderResult.body.id}/shipments/${shipmentLine.shipmentId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          fulfillmentType: "delivery",
          scheduledDate: "2026-05-22",
          notes: "Reduced line quantity",
          lines: [{ salesOrderLineId: shipmentLine.salesOrderLineId, quantity: "4" }],
        }),
      }
    );
    expect(editResponse.status).toBe(200);

    const [editedLine] = await db
      .select({
        id: salesShipmentLines.id,
        quantity: salesShipmentLines.quantity,
      })
      .from(salesShipmentLines)
      .where(eq(salesShipmentLines.salesShipmentId, shipmentLine.shipmentId));
    expect(editedLine.id).toBe(shipmentLine.id);
    expect(editedLine.quantity).toBe("4.0000");

    const allocationRows = await db
      .select({
        demandId: stockAllocations.demandId,
        quantity: stockAllocations.quantity,
        status: stockAllocations.status,
      })
      .from(stockAllocations)
      .where(
        and(
          eq(stockAllocations.demandType, "sales_shipment_line"),
          eq(stockAllocations.demandId, shipmentLine.id)
        )
      )
      .orderBy(asc(stockAllocations.status));
    expect(allocationRows).toEqual([
      {
        demandId: shipmentLine.id,
        quantity: "4.0000",
        status: "active",
      },
    ]);
  });

  test("shipment-level MO allocation cannot ship from unrelated FIFO stock", async ({
    db,
  }) => {
    const suffix = `${ts}-SHIP-MO-BLOCK`;
    const itemName = `Fast Shipment MO Material ${suffix}`;
    const itemSku = `FSMO-${ts}`;
    const customerResult = await createCustomer({
      name: `Fast Shipment MO Customer ${suffix}`,
    });
    expect(customerResult.status).toBe(201);

    const itemResult = await createItem({
      name: itemName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: itemSku,
      category: `Fast Shipment MO ${suffix}`,
      description: "Material for shipment MO allocation block",
      defaultPurchasePrice: "1",
      defaultSellingPrice: "10",
      stock: "5",
      safetyStock: "0",
    });
    expect(itemResult.status).toBe(201);

    const orderResult = await createSalesOrder({
      customerId: customerResult.body.id,
      status: "open",
      shipDate: "2026-05-23",
      lines: [{ itemId: itemResult.body.id, quantity: "2", unitPrice: "10" }],
    });
    expect(orderResult.status).toBe(201);

    const [shipmentLine] = await db
      .select({
        id: salesShipmentLines.id,
        salesOrderLineId: salesShipmentLines.salesOrderLineId,
        shipmentId: salesShipmentLines.salesShipmentId,
      })
      .from(salesShipmentLines)
      .innerJoin(
        salesShipments,
        eq(salesShipmentLines.salesShipmentId, salesShipments.id)
      )
      .where(eq(salesShipments.salesOrderId, orderResult.body.id as string));
    expect(shipmentLine).toBeTruthy();

    const [mo] = await db
      .insert(manufacturingOrders)
      .values({
        organizationId: getOrgId(),
        orderNumber: `MO-T-${ts}`,
        productId: itemResult.body.id as string,
        salesOrderId: orderResult.body.id as string,
        salesOrderLineId: shipmentLine.salesOrderLineId,
        productName: itemName,
        productSku: itemSku,
        unitName: "Each",
        requestedQuantity: "2",
        plannedQuantity: "2",
        status: "open",
        plannedDate: "2026-05-23",
      })
      .returning({ id: manufacturingOrders.id });

    await db.insert(stockAllocations).values({
      organizationId: getOrgId(),
      demandType: "sales_shipment_line",
      demandId: shipmentLine.id,
      itemId: itemResult.body.id as string,
      sourceType: "manufacturing_order",
      sourceId: mo.id,
      quantity: "2",
      status: "active",
      demandLabelSnapshot: "Shipment MO allocation",
      sourceLabelSnapshot: "MO waiting on output",
    });

    const shipResponse = await testFetch(
      `/api/sales-orders/${orderResult.body.id}/shipments/${shipmentLine.shipmentId}/ship`,
      { method: "POST" }
    );
    expect(shipResponse.status).toBe(409);
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
      page
        .locator(
          '[data-slot="erp-data-grid"] .ag-center-cols-container [role="row"][row-index]'
        )
        .evaluateAll(
        (rows, orderNumbers) =>
          (orderNumbers as string[]).map((orderNumber) =>
            rows.findIndex(
              (row) => row.textContent?.includes(orderNumber) ?? false
            )
          ),
        orderNumbers
      );

    await expect.poll(getSameDatePositions).toEqual([0, 1]);

    const confirmResponse = await testFetch(
      `/api/sales-orders/${firstOrderResult.body.id}/confirm`,
      {
        method: "POST",
        body: JSON.stringify({ confirmOversell: true }),
      }
    );
    expect(confirmResponse.status).toBe(200);

    await page.goto("/sales/orders");
    await showSalesOrderStatus(page, "Confirmed");
    await filterList(page, "Search orders", firstOrderNumber);
    await expect(salesOrderCard(page, firstOrderNumber)).toBeVisible();

    await showSalesOrderStatus(page, "Draft");
    await filterList(page, "Search orders", orderingCustomerName);
    await expect(salesOrderCard(page, secondOrderNumber)).toBeVisible();
  });

  test("open order schedules a planned shipment and selected MOs stay separate", async ({
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
      status: "open",
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
      { status: "planned", scheduledDate: "2026-06-02" },
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
      status: "open",
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
      status: "open",
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
      status: "open",
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

  test("creates MOs when earlier open demand consumes finished goods stock", async ({
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
      status: "open",
      lines: [{ itemId: stockedProductId, quantity: "4", unitPrice: "10" }],
    });
    expect(draftOrderResult.status).toBe(201);

    const orderResult = await createSalesOrder({
      customerId: stockedCustomerId,
      status: "open",
      lines: [{ itemId: stockedProductId, quantity: "3", unitPrice: "10" }],
    });
    expect(orderResult.status).toBe(201);
    const stockedOrderId = orderResult.body.id as string;

    const previewResponse = await testFetch(
      `/api/sales-orders/${stockedOrderId}/manufacturing-orders`
    );
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json();
    expect(preview.hasManufacturableLines).toBe(true);
    expect(preview.lines).toMatchObject([
      {
        itemName: productName,
        quantity: "2",
        status: "will_create",
        skipReason: null,
      },
    ]);

    const oversellOrderResult = await createSalesOrder({
      customerId: stockedCustomerId,
      status: "open",
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
        quantity: "4",
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
      hasManufacturableLines: true,
      manufacturableLineCount: 1,
    });
    expect(listRows.find((row) => row.id === oversellOrderId)).toMatchObject({
      hasManufacturableLines: true,
      manufacturableLineCount: 1,
    });

    const [oversellLine] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, oversellOrderId));
    const independentMoResult = await createManufacturingOrder({
      productId: stockedProductId,
      plannedQuantity: "4",
      ingredients: [{ itemId: materialId, quantityPerUnit: "1" }],
    });
    expect(independentMoResult.status).toBe(201);
    const independentMoId = independentMoResult.body.id as string;
    const allocationResponse = await testFetch(
      `/api/manufacturing-orders/${independentMoId}/output-allocation`,
      {
        method: "PUT",
        body: JSON.stringify({
          salesAllocations: [
            { salesOrderLineId: oversellLine.id, quantity: "4" },
          ],
          productionAllocations: [],
        }),
      }
    );
    expect(allocationResponse.status).toBe(200);

    const allocatedListResponse = await testFetch("/api/sales-orders");
    expect(allocatedListResponse.status).toBe(200);
    const allocatedListRows = (await allocatedListResponse.json()) as Array<{
      id: string;
      openManufacturingOrderCount: number;
      openManufacturingOrders: Array<{
        id: string;
        linkSource: string;
        status: string;
      }>;
      shippingReadiness: { state: string };
    }>;
    expect(allocatedListRows.find((row) => row.id === oversellOrderId)).toMatchObject({
      openManufacturingOrderCount: 1,
      openManufacturingOrders: [
        {
          id: independentMoId,
          linkSource: "output_allocation",
          status: "open",
        },
      ],
      shippingReadiness: { state: "in_production" },
    });

    const [order] = await db
      .select({ orderNumber: salesOrders.orderNumber })
      .from(salesOrders)
      .where(eq(salesOrders.id, stockedOrderId));

    await page.goto("/sales/orders");
    await showSalesOrderStatus(page, "Confirmed");
    await filterList(page, "Search orders", order.orderNumber);

    const orderCard = salesOrderCard(page, order.orderNumber);
    await expect(orderCard.getByRole("button", { name: "Create MOs" })).toBeVisible();
  });

  test("ships a planned shipment from sales order detail", async ({ page, db }) => {
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
      status: "open",
      lines: [{ itemId: webShipProductId, quantity: "2", unitPrice: "10" }],
    });
    expect(orderResult.status).toBe(201);
    const webShipOrderId = orderResult.body.id as string;

    await page.goto(`/sales/orders/${webShipOrderId}`);
    const shipmentRow = page.getByRole("row", { name: /Planned/ });
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
    expect(shippedOrder.status).toBe("done");
    expect(shippedOrder.shippedAt).not.toBeNull();

    const [shippedShipment] = await db
      .select({ status: salesShipments.status, shippedAt: salesShipments.shippedAt })
      .from(salesShipments)
      .where(eq(salesShipments.salesOrderId, webShipOrderId));
    expect(shippedShipment.status).toBe("shipped");
    expect(shippedShipment.shippedAt).not.toBeNull();
  });

  test("plans a shipment before stock is allocated", async ({ db }) => {
    const suffix = `${ts}-OPEN-SHORT`;
    const customerResult = await createCustomer({
      name: `Fast Open Short Customer ${suffix}`,
    });
    expect(customerResult.status).toBe(201);

    const itemResult = await createItem({
      name: `Fast Open Short Material ${suffix}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-OPEN-SHORT-${suffix}`,
      category: `Fast Open Short ${suffix}`,
      description: "Material for shipment planning without allocation",
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
        status: "open",
        confirmOversell: true,
        orderDate: "2026-04-23",
        shipDate: "2026-04-23",
        requestedDate: "2026-04-23",
        notes: "Shipment before allocation",
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

    const [line] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, shortOrderId));

    const [initialPlannedShipment] = await db
      .select({ id: salesShipments.id })
      .from(salesShipments)
      .where(eq(salesShipments.salesOrderId, shortOrderId));
    if (!initialPlannedShipment) {
      throw new Error("Expected open order creation to create a planned shipment.");
    }

    const splitExistingResponse = await testFetch(
      `/api/sales-orders/${shortOrderId}/shipments/${initialPlannedShipment.id}`,
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

  test("split that moves every line uses existing planned-shipment delete semantics", async ({
    db,
  }) => {
    const suffix = `${ts}-SPLIT-EMPTY`;
    const customerResult = await createCustomer({
      name: `Fast Empty Split Customer ${suffix}`,
    });
    expect(customerResult.status).toBe(201);

    const itemResult = await createItem({
      name: `Fast Empty Split Material ${suffix}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FSE-${ts}`,
      category: `Fast Empty Split ${suffix}`,
      description: "Material for empty split shipment behavior",
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
        status: "open",
        confirmOversell: true,
        orderDate: "2026-04-24",
        shipDate: "2026-04-24",
        requestedDate: "2026-04-24",
        notes: "Split full source shipment",
        lines: [
          {
            itemId: itemResult.body.id,
            quantity: "4",
            unitPrice: "10",
          },
        ],
      }),
    });
    expect(orderResponse.status).toBe(201);
    const orderBody = await orderResponse.json();
    const orderId = orderBody.id as string;

    const [line] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, orderId));

    const [initialPlannedShipment] = await db
      .select({ id: salesShipments.id })
      .from(salesShipments)
      .where(eq(salesShipments.salesOrderId, orderId));
    expect(initialPlannedShipment).toBeTruthy();

    const splitResponse = await testFetch(`/api/sales-orders/${orderId}/shipments`, {
      method: "POST",
      body: JSON.stringify({
        splitFromShipmentId: initialPlannedShipment.id,
        fulfillmentType: "delivery",
        scheduledDate: "2026-04-24",
        notes: "Move full source quantity",
        lines: [{ salesOrderLineId: line.id, quantity: "4" }],
      }),
    });
    expect(splitResponse.status).toBe(201);
    const splitShipment = await splitResponse.json();

    const sourceRows = await db
      .select({ id: salesShipments.id })
      .from(salesShipments)
      .where(eq(salesShipments.id, initialPlannedShipment.id));
    expect(sourceRows).toHaveLength(0);

    const [createdLine] = await db
      .select({ quantity: salesShipmentLines.quantity })
      .from(salesShipmentLines)
      .where(eq(salesShipmentLines.salesShipmentId, splitShipment.id));
    expect(createdLine.quantity).toBe("4.0000");
  });
});
