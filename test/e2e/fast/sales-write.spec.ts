import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Page } from "@playwright/test";
import { test, expect, filterList, getIdFromUrl, selectDate } from "../fixtures";
import {
  inventoryItemBalances,
  inventoryLotBalances,
  inventoryReservationsSummary,
  inventoryEvents,
  customerContacts,
  customerCorrespondence,
  customerCorrespondenceAttendees,
  customerProjectFiles,
  customerProjects,
  integrationConnections,
  lots,
  manufacturingOrderIngredients,
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
  completeManufacturingOrder,
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
  updateSalesOrder,
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

function sumPlannedQuantityByItemId(
  rows: Array<{ itemId: string; plannedQuantity: string }>
) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.itemId, (totals.get(row.itemId) ?? 0) + Number(row.plannedQuantity));
  }
  return new Map(
    [...totals.entries()].map(([itemId, quantity]) => [
      itemId,
      quantity.toFixed(4),
    ])
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function gotoSalesAllocation(page: Page) {
  await page.goto("/sales/allocation", {
    waitUntil: "commit",
    timeout: 180_000,
  });
}

async function openAllocationManagerFromMatrix(params: {
  page: Page;
  orderNumber: string;
  itemName: string;
}) {
  const { page, orderNumber, itemName } = params;
  await gotoSalesAllocation(page);
  await page.getByLabel("Search sales allocations").fill(orderNumber);
  await expect(page.getByText("Pool coverage").first()).toBeVisible();
  await page.getByText("Pool coverage").first().click();
  await expect(page.getByRole("dialog", { name: /Allocate/ })).toHaveCount(0);

  for (const expandButton of await page
    .getByRole("button", { name: /^Expand / })
    .all()) {
    if (await expandButton.isVisible()) {
      await expandButton.click();
    }
  }

  const orderRow = page.getByRole("row").filter({ hasText: orderNumber }).first();
  await expect(orderRow).toBeVisible();

  const allocateButton = page
    .getByRole("button", { name: new RegExp(`^Allocate ${escapeRegExp(itemName)}$`) })
    .first();
  await expect(allocateButton).toBeVisible();
  const buttonBox = await allocateButton.boundingBox();
  const rowBox = await orderRow.boundingBox();
  if (!buttonBox || !rowBox) {
    throw new Error("Unable to locate allocation matrix cell.");
  }
  await page.mouse.click(
    buttonBox.x + buttonBox.width / 2,
    rowBox.y + rowBox.height / 2
  );

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
  demandType: "sales_order_line" = "sales_order_line"
) {
  const response = await testFetch(
    `/api/allocation/workspace?demandType=${demandType}&demandId=${lineId}&itemId=${itemId}`
  );
  const body = await response.json();
  return { response, body };
}

async function saveSalesAllocation(params: {
  demandType?: "sales_order_line";
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
    await page.goto("/sales/customer");
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
    await expect(page.getByRole("heading", { name: customerName })).toBeVisible();

    await page.getByLabel("Email").fill(`fast-sales-${ts}@example.com`);
    await page.getByLabel("Email").blur();
    await page.getByLabel("Phone").fill("555-0300");
    await page.getByLabel("Phone").blur();
    await page.getByLabel("Notes").fill("Fast customer smoke test");
    const updateCustomerResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().endsWith(`/api/customers/${customerId}`)
    );
    await page.getByLabel("Notes").blur();
    expect((await updateCustomerResponsePromise).status()).toBe(200);

    await expect
      .poll(async () => {
        const [customer] = await db
          .select()
          .from(salesCustomers)
          .where(eq(salesCustomers.id, customerId));
        return {
          email: customer.email,
          phone: customer.phone,
          notes: customer.notes,
        };
      })
      .toEqual({
        email: `fast-sales-${ts}@example.com`,
        phone: "555-0300",
        notes: "Fast customer smoke test",
      });

    await page.getByLabel("Phone").fill("555-0310");
    await page.getByLabel("Notes").fill("Fast customer updated");
    const secondUpdateCustomerResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().endsWith(`/api/customers/${customerId}`)
    );
    await page.getByLabel("Notes").blur();
    expect((await secondUpdateCustomerResponsePromise).status()).toBe(200);

    await expect
      .poll(async () => {
        const [updatedCustomer] = await db
          .select()
          .from(salesCustomers)
          .where(eq(salesCustomers.id, customerId));
        return {
          phone: updatedCustomer.phone,
          notes: updatedCustomer.notes,
        };
      })
      .toEqual({
        phone: "555-0310",
        notes: "Fast customer updated",
      });
  });

  test("adds customer contacts, correspondence, and projects from detail", async ({
    page,
    db,
  }) => {
    await page.goto(`/sales/customers/${customerId}`);
    await expect(page.getByRole("heading", { name: customerName })).toBeVisible();

    const contactResponse = await testFetch(`/api/customers/${customerId}/contacts`, {
      method: "POST",
      body: JSON.stringify({
        name: `Spencer CRM ${ts}`,
        title: "Project coordinator",
        email: `spencer-${ts}@example.com`,
        phone: "555-0168",
        roles: ["primary"],
        notes: "Fast CRM contact",
      }),
    });
    expect(contactResponse.status).toBe(201);
    await page.reload();
    await expect(page.getByText(`Spencer CRM ${ts}`)).toBeVisible();

    const [contact] = await db
      .select()
      .from(customerContacts)
      .where(eq(customerContacts.customerId, customerId));
    expect(contact.name).toBe(`Spencer CRM ${ts}`);

    const activityResponse = await testFetch(`/api/customers/${customerId}/correspondence`, {
      method: "POST",
      body: JSON.stringify({
        type: "note",
        title: "Group install call",
        body: "Discussed soil test and delivery timing.",
        attendeeContactIds: [contact.id],
      }),
    });
    expect(activityResponse.status).toBe(201);

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

    const projectResponse = await testFetch(`/api/customers/${customerId}/projects`, {
      method: "POST",
      body: JSON.stringify({
        name: `Example Construction ${ts}`,
        status: "planning",
        startDate: null,
        targetEndDate: null,
        summary: "Fast CRM project",
      }),
    });
    expect(projectResponse.status).toBe(201);
    await page.reload();
    await expect(page.getByText(`Example Construction ${ts}`)).toBeVisible();

    const [project] = await db
      .select()
      .from(customerProjects)
      .where(eq(customerProjects.customerId, customerId));
    expect(project.name).toBe(`Example Construction ${ts}`);
    expect(project.status).toBe("planning");
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

    const filename = `soil-test-${ts}.txt`;
    const content = `Soil test upload smoke ${ts}`;
    const uploadResponse = await page.request.post(
      `/api/customers/${customerId}/projects/${crmProjectId}/files`,
      {
        multipart: {
          file: {
            name: filename,
            mimeType: "text/plain",
            buffer: Buffer.from(content),
          },
        },
      }
    );

    expect(uploadResponse.status()).toBe(201);
    const uploadedFile = (await uploadResponse.json()) as { filename: string };
    expect(uploadedFile.filename).toBe(filename);

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
    test.slow();

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
      sellable: true,
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

    const customOrderNumber = `SO-CUSTOM-${ts}`;
    const createOrderResult = await createSalesOrder({
      orderNumber: customOrderNumber,
      customerId,
      customerProjectId: crmProjectId,
      orderDate: "2026-04-01",
      shipDate: "2026-04-15",
      requestedDate: "2026-04-15",
      notes: orderNote,
      lines: [{ itemId: productId, quantity: "3", unitPrice: "34.99" }],
      shipments: [
        {
          fulfillmentType: "delivery",
          scheduledDate: "2026-04-15",
          deliveryDate: "2026-04-15",
          lines: [{ itemId: productId, quantity: "2" }],
        },
        {
          fulfillmentType: "delivery",
          scheduledDate: "2026-04-15",
          deliveryDate: "2026-04-15",
          lines: [{ itemId: productId, quantity: "1" }],
        },
      ],
    });
    expect(createOrderResult.status).toBe(201);
    orderId = createOrderResult.body.id;

    await page.goto(`/sales/orders/${orderId}`);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: customOrderNumber,
      })
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(customerName).first()).toBeVisible();

    const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, orderId));
    expect(order.customerId).toBe(customerId);
    expect(order.customerProjectId).toBe(crmProjectId);
    expect(order.customerName).toBe(customerName);
    expect(order.orderNumber).toBe(customOrderNumber);
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
      page.getByRole("heading", {
        level: 1,
        name: order.orderNumber,
      })
    ).toBeVisible();
    await expect(page.getByText(customerName).first()).toBeVisible();
    await expect(page.getByText(`Example Construction ${ts}`).first()).toBeVisible();

    await page.goto(`/sales/customers/${customerId}?project=${crmProjectId}#projects`);
    await expect(page.getByRole("heading", { name: /^Projects/ })).toBeVisible();
    await expect(page.getByText(`Example Construction ${ts}`).first()).toBeVisible();
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

    await db
      .insert(integrationConnections)
      .values({
        organizationId: await getOrgId(),
        provider: "xero",
        tenantId: `tenant-sales-${ts}`,
        tenantName: "Paonia Soil Co.",
        authorizedTenants: [
          { tenantId: `tenant-sales-${ts}`, tenantName: "Paonia Soil Co." },
        ],
        accessTokenCiphertext: `test-access-token-ciphertext-${ts}`,
        refreshTokenCiphertext: `test-refresh-token-ciphertext-${ts}`,
        tokenEncryptionKeyId: "test",
        tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        defaultAccountCode: null,
        defaultTaxType: "OUTPUT",
        invoiceStatusPreference: "DRAFT",
        autoPushSalesInvoices: false,
        autoPushPurchaseOrders: false,
        autoEmailSalesInvoices: false,
        autoEmailPurchaseOrders: false,
        purchaseOrderDefaultAccountCode: "500",
        purchaseOrderDefaultTaxType: "NONE",
        purchaseOrderStatusPreference: "DRAFT",
      })
      .onConflictDoUpdate({
        target: [
          integrationConnections.organizationId,
          integrationConnections.provider,
        ],
        set: {
          tenantId: `tenant-sales-${ts}`,
          tenantName: "Paonia Soil Co.",
          authorizedTenants: [
            { tenantId: `tenant-sales-${ts}`, tenantName: "Paonia Soil Co." },
          ],
          accessTokenCiphertext: `test-access-token-ciphertext-${ts}`,
          refreshTokenCiphertext: `test-refresh-token-ciphertext-${ts}`,
          tokenEncryptionKeyId: "test",
          tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
          defaultAccountCode: null,
          defaultTaxType: "OUTPUT",
          invoiceStatusPreference: "DRAFT",
          autoPushSalesInvoices: false,
          autoPushPurchaseOrders: false,
          autoEmailSalesInvoices: false,
          autoEmailPurchaseOrders: false,
          purchaseOrderDefaultAccountCode: "500",
          purchaseOrderDefaultTaxType: "NONE",
          purchaseOrderStatusPreference: "DRAFT",
          updatedAt: new Date(),
        },
      });

    await page.goto(`/sales/orders/${orderId}`);
    await expect(page.getByText("Confirm the order before shipping.")).toHaveCount(0);
    await expect(page.getByText("Failed to confirm order.")).toHaveCount(0);

    const shipments = await db
      .select()
      .from(salesShipments)
      .where(eq(salesShipments.salesOrderId, orderId))
      .orderBy(asc(salesShipments.sequence));
    expect(shipments).toHaveLength(2);
    expect(shipments[0].scheduledDate).toBe("2026-04-15");

    await page.goto(`/sales/orders/${orderId}`);
    await page.getByLabel(`Actions for ${shipments[0].shipmentNumber}`).click();
    await page.getByRole("menuitem", { name: "Edit shipment" }).click();
    const dialogShipmentQuantityInput = page
      .getByRole("dialog")
      .getByLabel(`Shipment quantity for ${productName}`);
    await expect(dialogShipmentQuantityInput).toHaveValue("2");
    await expect(page.getByRole("dialog").getByText("Max 2")).toBeVisible();
    await dialogShipmentQuantityInput.fill("3");
    await expect(dialogShipmentQuantityInput).toHaveValue("2");
  });

  test("auto-generates numbers and rejects duplicate custom sales order numbers", async () => {
    const autoOrderResult = await createSalesOrder({
      customerId,
      status: "open",
      orderDate: "2026-04-02",
      requestedDate: "2026-04-16",
      lines: [{ itemId: productId, quantity: "1", unitPrice: "34.99" }],
    });
    expect(autoOrderResult.status).toBe(201);
    await expect(
      getSalesOrderNumber(autoOrderResult.body.id as string)
    ).resolves.toMatch(/^SO-\d{4}-\d{4}$/);

    const duplicateOrderNumber = `SO-DUP-${ts}`;
    const firstCustomResult = await createSalesOrder({
      orderNumber: duplicateOrderNumber,
      customerId,
      status: "open",
      orderDate: "2026-04-03",
      requestedDate: "2026-04-17",
      lines: [{ itemId: productId, quantity: "1", unitPrice: "34.99" }],
    });
    expect(firstCustomResult.status).toBe(201);
    await expect(
      getSalesOrderNumber(firstCustomResult.body.id as string)
    ).resolves.toBe(duplicateOrderNumber);

    const duplicateResult = await createSalesOrder({
      orderNumber: duplicateOrderNumber,
      customerId,
      status: "open",
      orderDate: "2026-04-04",
      requestedDate: "2026-04-18",
      lines: [{ itemId: productId, quantity: "1", unitPrice: "34.99" }],
    });
    expect(duplicateResult.status).toBe(400);
    expect(duplicateResult.body.errors.orderNumber).toContain(
      "A sales order with this number already exists."
    );
  });

  test("creating without a ship date creates unplanned demand without a shipment", async ({
    db,
  }) => {
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
        shipments: [],
      }),
    });
    expect(createResponse.status).toBe(201);
    const body = await createResponse.json();

    const shipmentRows = await db
      .select({ id: salesShipments.id })
      .from(salesShipments)
      .where(eq(salesShipments.salesOrderId, body.id as string));
    expect(shipmentRows).toHaveLength(0);

    const [line] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, body.id as string));
    expect(line).toBeTruthy();

    const workspaceResponse = await testFetch(
      `/api/allocation/workspace?demandType=sales_order_line&demandId=${line.id}&itemId=${productId}`
    );
    expect(workspaceResponse.status).toBe(200);
    const workspace = await workspaceResponse.json();
    expect(workspace.primaryDemand).toEqual(
      expect.objectContaining({
        demandType: "sales_order_line",
        demandId: line.id,
        openQty: "1",
      })
    );
  });

  test("creates a draft sales order with customer only", async ({ db }) => {
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
        shipments: [],
      }),
    });
    expect(createResponse.status).toBe(201);
    const body = await createResponse.json();
    expect(body.id).toBeTruthy();

    const [created] = await db
      .select({
        customerId: salesOrders.customerId,
        status: salesOrders.status,
      })
      .from(salesOrders)
      .where(eq(salesOrders.id, body.id as string));
    expect(created).toEqual({ customerId, status: "open" });

    const lines = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, body.id as string));
    expect(lines).toHaveLength(0);
  });

  test("saving a shipment delivery date before the ship date returns a readable error", async () => {
    const createResponse = await testFetch("/api/sales-orders", {
      method: "POST",
      body: JSON.stringify({
        customerId,
        status: "open",
        orderDate: "2026-04-10",
        shipDate: null,
        requestedDate: "2026-04-11",
        notes: null,
        lines: [{ itemId: productId, quantity: "1", unitPrice: "34.99" }],
        shipments: [
          {
            fulfillmentType: "delivery",
            scheduledDate: "2026-04-12",
            deliveryDate: "2026-04-11",
            notes: null,
            lines: [{ itemId: productId, quantity: "1" }],
          },
        ],
      }),
    });
    expect(createResponse.status).toBe(400);
    const body = await createResponse.json();
    expect(body.error).toBe("Delivery date cannot be before ship date");
    expect(body.errors["shipments.0.deliveryDate"][0]).toBe(
      "Delivery date cannot be before ship date"
    );
  });

  test("saving planned shipments cannot exceed the ordered quantity", async () => {
    const createResponse = await testFetch("/api/sales-orders", {
      method: "POST",
      body: JSON.stringify({
        customerId,
        status: "open",
        orderDate: "2026-04-10",
        shipDate: null,
        requestedDate: "2026-04-15",
        notes: null,
        lines: [{ itemId: productId, quantity: "3", unitPrice: "34.99" }],
        shipments: [
          {
            fulfillmentType: "delivery",
            scheduledDate: "2026-04-12",
            deliveryDate: "2026-04-14",
            notes: null,
            lines: [{ itemId: productId, quantity: "2" }],
          },
          {
            fulfillmentType: "delivery",
            scheduledDate: "2026-04-13",
            deliveryDate: "2026-04-15",
            notes: null,
            lines: [{ itemId: productId, quantity: "2" }],
          },
        ],
      }),
    });

    expect(createResponse.status).toBe(400);
    const body = await createResponse.json();
    expect(body.error).toBe("Shipment quantities cannot exceed ordered quantity");
    expect(body.errors["shipments.0.lines.0.quantity"][0]).toBe(
      "Shipment quantities cannot exceed ordered quantity"
    );
    expect(body.errors["shipments.1.lines.0.quantity"][0]).toBe(
      "Shipment quantities cannot exceed ordered quantity"
    );
  });

  test("explicit shipment rows create separately and can all be cleared on edit", async ({
    db,
  }) => {
    const suffix = `${ts}-EXPLICIT-SHIP`;
    const explicitCustomerResult = await createCustomer({
      name: `Fast Explicit Shipment Customer ${suffix}`,
    });
    expect(explicitCustomerResult.status).toBe(201);
    const explicitItemResult = await createItem({
      name: `Fast Explicit Shipment Product ${suffix}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-EXPLICIT-SHIP-${suffix}`,
      category: `Fast Explicit Shipment ${suffix}`,
      description: "Material for explicit shipment row coverage",
      defaultPurchasePrice: "1",
      defaultSellingPrice: "34.99",
      stock: "10",
      safetyStock: "0",
    });
    expect(explicitItemResult.status).toBe(201);
    const explicitCustomerId = explicitCustomerResult.body.id as string;
    const explicitItemId = explicitItemResult.body.id as string;

    const createResponse = await createSalesOrder({
      customerId: explicitCustomerId,
      status: "open",
      orderDate: "2026-04-01",
      requestedDate: "2026-04-20",
      lines: [{ itemId: explicitItemId, quantity: "5", unitPrice: "34.99" }],
      shipments: [
        {
          fulfillmentType: "delivery",
          scheduledDate: "2026-04-10",
          deliveryDate: "2026-04-12",
          notes: "First planned shipment",
          lines: [{ itemId: explicitItemId, quantity: "2" }],
        },
        {
          fulfillmentType: "pickup",
          scheduledDate: "2026-04-18",
          deliveryDate: "2026-04-20",
          notes: "Second planned shipment",
          lines: [{ itemId: explicitItemId, quantity: "3" }],
        },
      ],
    });
    expect(createResponse.status).toBe(201);
    const explicitOrderId = createResponse.body.id as string;

    const createdShipments = await db
      .select({
        id: salesShipments.id,
        shipmentNumber: salesShipments.shipmentNumber,
        fulfillmentType: salesShipments.fulfillmentType,
        scheduledDate: salesShipments.scheduledDate,
        lineQuantity: salesShipmentLines.quantity,
      })
      .from(salesShipments)
      .innerJoin(
        salesShipmentLines,
        eq(salesShipmentLines.salesShipmentId, salesShipments.id)
      )
      .where(eq(salesShipments.salesOrderId, explicitOrderId))
      .orderBy(asc(salesShipments.sequence));

    expect(createdShipments).toMatchObject([
      {
        shipmentNumber: expect.stringMatching(/-S1$/),
        fulfillmentType: "delivery",
        scheduledDate: "2026-04-10",
        lineQuantity: "2.0000",
      },
      {
        shipmentNumber: expect.stringMatching(/-S2$/),
        fulfillmentType: "pickup",
        scheduledDate: "2026-04-18",
        lineQuantity: "3.0000",
      },
    ]);

    const [explicitLine] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, explicitOrderId));
    const overplanEditResponse = await testFetch(
      `/api/sales-orders/${explicitOrderId}/shipments/${createdShipments[0].id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          fulfillmentType: "delivery",
          scheduledDate: "2026-04-10",
          deliveryDate: "2026-04-12",
          notes: "Overplanned edit",
          lines: [{ salesOrderLineId: explicitLine.id, quantity: "4" }],
        }),
      }
    );
    expect(overplanEditResponse.status).toBe(400);
    const overplanEditBody = await overplanEditResponse.json();
    expect(overplanEditBody.error).toBe("Cannot plan more than the remaining quantity.");
    expect(overplanEditBody.errors["lines.0.quantity"][0]).toBe("Must be 2 or less");

    const clearResponse = await updateSalesOrder(explicitOrderId, {
      customerId: explicitCustomerId,
      status: "open",
      orderDate: "2026-04-01",
      shipDate: null,
      requestedDate: "2026-04-20",
      notes: null,
      lines: [{ itemId: explicitItemId, quantity: "5", unitPrice: "34.99" }],
      shipments: [],
    });
    expect(clearResponse.status).toBe(200);

    const remainingShipments = await db
      .select({ id: salesShipments.id })
      .from(salesShipments)
      .where(eq(salesShipments.salesOrderId, explicitOrderId));
    expect(remainingShipments).toHaveLength(0);

    const [order] = await db
      .select({ shipDate: salesOrders.shipDate })
      .from(salesOrders)
      .where(eq(salesOrders.id, explicitOrderId));
    expect(order.shipDate).toBeNull();
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
        sellable: true,
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
      shipDate: null,
      requestedDate: null,
      notes: "Fast detail line delete regression",
      lines: [
        { itemId: detailDeleteId, quantity: "1", unitPrice: "10" },
        { itemId: detailKeepId, quantity: "2", unitPrice: "10" },
      ],
      shipments: [],
    });
    expect(detailOrderResult.status).toBe(201);
    const detailOrderId = detailOrderResult.body.id as string;

    await page.goto(`/sales/orders/${detailOrderId}`);
    const detailDeleteResponsePromise = page.waitForResponse(
      (response) =>
        ["PATCH", "PUT"].includes(response.request().method()) &&
        response.url().endsWith(`/api/sales-orders/${detailOrderId}`)
    );
    await page
      .getByRole("row", { name: new RegExp(firstProductName) })
      .getByRole("button", { name: "Delete row" })
      .click();
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
      shipments: plannedShipmentForItems({
        shipDate: "2026-04-18",
        lines: [{ itemId: editItemId, quantity: "2" }],
      }),
    });
    expect(editOrderResult.status).toBe(201);
    const editOrderId = editOrderResult.body.id as string;
    expect((await confirmSalesOrder(editOrderId)).status).toBe(200);

    const [orderBeforeEdit] = await db
      .select({
        orderNumber: salesOrders.orderNumber,
        customerName: salesOrders.customerName,
      })
      .from(salesOrders)
      .where(eq(salesOrders.id, editOrderId));

    await page.goto(`/sales/orders/${editOrderId}`);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: orderBeforeEdit.orderNumber,
      })
    ).toBeVisible();

    const editedOrderNumber = `SO-EDIT-${ts}`;
    const updateOrderResult = await updateSalesOrder(editOrderId, {
      orderNumber: editedOrderNumber,
      customerId: editCustomerId,
      status: "open",
      shipDate: "2026-04-18",
      requestedDate: "2026-04-18",
      notes: "Confirmed order edited after approval",
      lines: [{ itemId: editItemId, quantity: "4", unitPrice: "12" }],
      shipments: plannedShipmentForItems({
        shipDate: "2026-04-18",
        lines: [{ itemId: editItemId, quantity: "4" }],
      }),
    });
    expect(updateOrderResult.status).toBe(200);

    await page.goto(`/sales/orders/${editOrderId}`);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: editedOrderNumber,
      })
    ).toBeVisible();

    const [orderAfterEdit] = await db
      .select({
        orderNumber: salesOrders.orderNumber,
        status: salesOrders.status,
        notes: salesOrders.notes,
        totalAmount: salesOrders.totalAmount,
      })
      .from(salesOrders)
      .where(eq(salesOrders.id, editOrderId));
    expect(orderAfterEdit.orderNumber).toBe(editedOrderNumber);
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

  test("editing an order with preserved allocations does not double-count reservations", async ({
    db,
  }) => {
    const preserveCustomerResult = await createCustomer({
      name: `Fast Preserve Allocation Customer ${ts}`,
      email: `fast-preserve-alloc-${ts}@example.com`,
    });
    expect(preserveCustomerResult.status).toBe(201);
    const preserveCustomerId = preserveCustomerResult.body.id as string;

    const preserveItemResult = await createItem({
      name: `Fast Preserve Allocation Material ${ts}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-PRESERVE-ALLOC-${ts}`,
      category: `Fast Sales ${ts}`,
      description: "Material for preserved-allocation reservation regression",
      defaultPurchasePrice: "1",
      defaultSellingPrice: "10",
      stock: "20",
      safetyStock: "0",
    });
    expect(preserveItemResult.status).toBe(201);
    const preserveItemId = preserveItemResult.body.id as string;

    const preserveOrderResult = await createSalesOrder({
      customerId: preserveCustomerId,
      status: "open",
      shipDate: null,
      requestedDate: "2026-05-25",
      lines: [{ itemId: preserveItemId, quantity: "5", unitPrice: "10" }],
    });
    expect(preserveOrderResult.status).toBe(201);
    const preserveOrderId = preserveOrderResult.body.id as string;

    const [initialLine] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, preserveOrderId));

    const [openingLot] = await db
      .select({ id: lots.id })
      .from(lots)
      .where(eq(lots.itemId, preserveItemId))
      .limit(1);
    expect(openingLot).toBeTruthy();

    await db.insert(stockAllocations).values({
      organizationId: getOrgId(),
      demandType: "sales_order_line",
      demandId: initialLine.id,
      itemId: preserveItemId,
      sourceType: "inventory_lot",
      sourceId: openingLot.id,
      quantity: "5",
      status: "active",
      demandLabelSnapshot: "Preserved across edit",
      sourceLabelSnapshot: "Opening stock",
    });

    const editResponse = await updateSalesOrder(preserveOrderId, {
      customerId: preserveCustomerId,
      status: "open",
      shipDate: null,
      requestedDate: "2026-05-25",
      notes: "Preserved allocation edit",
      lines: [{ itemId: preserveItemId, quantity: "5", unitPrice: "10" }],
    });
    expect(editResponse.status).toBe(200);

    const [lineAfterEdit] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, preserveOrderId));
    expect(lineAfterEdit.id).not.toBe(initialLine.id);

    const [preservedAllocation] = await db
      .select({
        demandId: stockAllocations.demandId,
        quantity: stockAllocations.quantity,
        status: stockAllocations.status,
      })
      .from(stockAllocations)
      .where(
        and(
          eq(stockAllocations.itemId, preserveItemId),
          eq(stockAllocations.status, "active")
        )
      );
    expect(preservedAllocation.demandId).toBe(lineAfterEdit.id);
    expect(parseFloat(preservedAllocation.quantity)).toBe(5);

    const [lineReservation] = await db
      .select({ quantity: inventoryReservationsSummary.quantity })
      .from(inventoryReservationsSummary)
      .where(
        and(
          eq(inventoryReservationsSummary.itemId, preserveItemId),
          eq(inventoryReservationsSummary.referenceType, "sales_order_line"),
          eq(inventoryReservationsSummary.referenceId, lineAfterEdit.id)
        )
      );
    expect(parseFloat(lineReservation.quantity)).toBe(5);

    const [balanceAfterEdit] = await db
      .select({
        committedQty: inventoryItemBalances.committedQty,
        demandQty: inventoryItemBalances.demandQty,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, preserveItemId));
    expect(parseFloat(balanceAfterEdit.committedQty)).toBe(5);
    expect(parseFloat(balanceAfterEdit.demandQty)).toBe(5);
  });

  test("editing an order with preserved allocations does not orphan shipment-line reservation summaries", async ({
    db,
  }) => {
    const orphanCustomerResult = await createCustomer({
      name: `Fast Orphan Reservation Customer ${ts}`,
      email: `fast-orphan-res-${ts}@example.com`,
    });
    expect(orphanCustomerResult.status).toBe(201);
    const orphanCustomerId = orphanCustomerResult.body.id as string;

    const orphanItemResult = await createItem({
      name: `Fast Orphan Reservation Material ${ts}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-ORPHAN-RES-${ts}`,
      category: `Fast Sales ${ts}`,
      description: "Material for orphan reservation regression",
      defaultPurchasePrice: "1",
      defaultSellingPrice: "10",
      stock: "20",
      safetyStock: "0",
    });
    expect(orphanItemResult.status).toBe(201);
    const orphanItemId = orphanItemResult.body.id as string;

    const orphanOrderResult = await createSalesOrder({
      customerId: orphanCustomerId,
      status: "open",
      shipDate: "2026-05-26",
      requestedDate: "2026-05-26",
      lines: [{ itemId: orphanItemId, quantity: "5", unitPrice: "10" }],
    });
    expect(orphanOrderResult.status).toBe(201);
    const orphanOrderId = orphanOrderResult.body.id as string;

    const [initialOrphanLine] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, orphanOrderId));

    const [orphanLot] = await db
      .select({ id: lots.id })
      .from(lots)
      .where(eq(lots.itemId, orphanItemId))
      .limit(1);
    expect(orphanLot).toBeTruthy();

    await db.insert(stockAllocations).values({
      organizationId: getOrgId(),
      demandType: "sales_order_line",
      demandId: initialOrphanLine.id,
      itemId: orphanItemId,
      sourceType: "inventory_lot",
      sourceId: orphanLot.id,
      quantity: "5",
      status: "active",
      demandLabelSnapshot: "Preserved across edit with shipment",
      sourceLabelSnapshot: "Opening stock",
    });

    const orphanEditResponse = await updateSalesOrder(orphanOrderId, {
      customerId: orphanCustomerId,
      status: "open",
      shipDate: "2026-05-26",
      requestedDate: "2026-05-26",
      notes: "Orphan reservation edit",
      lines: [{ itemId: orphanItemId, quantity: "5", unitPrice: "10" }],
    });
    expect(orphanEditResponse.status).toBe(200);

    const summaryRows = await db
      .select({
        referenceId: inventoryReservationsSummary.referenceId,
        quantity: inventoryReservationsSummary.quantity,
      })
      .from(inventoryReservationsSummary)
      .where(
        and(
          eq(inventoryReservationsSummary.itemId, orphanItemId),
          eq(inventoryReservationsSummary.referenceType, "sales_order_line")
        )
      );
    const orphanRow = summaryRows.find(
      (row) => row.referenceId === initialOrphanLine.id
    );
    expect(orphanRow).toBeUndefined();

    const [balanceAfterOrphanEdit] = await db
      .select({ committedQty: inventoryItemBalances.committedQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, orphanItemId));
    const totalLineReservation = summaryRows.reduce(
      (sum, row) => sum + parseFloat(row.quantity),
      0
    );
    expect(parseFloat(balanceAfterOrphanEdit.committedQty)).toBe(
      totalLineReservation
    );
  });

  test("allocation manager does not count unallocated available stock as allocated", async ({
    page,
  }) => {
    test.setTimeout(180_000);

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
      sellable: true,
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
    test.setTimeout(240_000);

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
      sellable: true,
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
      shipDate: "2026-05-12",
      lines: [{ itemId: tokenMaterialId, quantity: "6", unitPrice: "10" }],
      shipments: plannedShipmentForItems({
        shipDate: "2026-05-12",
        lines: [{ itemId: tokenMaterialId, quantity: "6" }],
      }),
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

    const allocationRows = await db
      .select({
        sourceType: stockAllocations.sourceType,
        quantity: stockAllocations.quantity,
      })
      .from(stockAllocations)
      .where(
        and(
          eq(stockAllocations.demandType, "sales_order_line"),
          eq(stockAllocations.demandId, line.id),
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

  test("allocation matrix collapse scopes demand math and exposes inactive products", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const suffix = `${ts}-ALLOC-SCOPE`;
    const customerResult = await createCustomer({
      name: `Fast Scope Customer ${suffix}`,
      email: `fast-scope-${suffix}@example.com`,
    });
    expect(customerResult.status).toBe(201);
    const customerId = customerResult.body.id as string;

    const componentResult = await createItem({
      name: `Fast Scope Component ${suffix}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-SCOPE-COMP-${suffix}`,
      category: `Fast Scope ${suffix}`,
      description: "Component for allocation collapse scope product",
      defaultPurchasePrice: "1",
      defaultSellingPrice: null,
      stock: "30",
      safetyStock: "0",
      bom: [],
    });
    expect(componentResult.status).toBe(201);
    const componentId = componentResult.body.id as string;

    const productResult = await createItem({
      name: `Fast Scope Product ${suffix}`,
      itemType: "product",
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-SCOPE-${suffix}`,
      category: `Fast Scope ${suffix}`,
      description: "Product for allocation collapse scope coverage",
      defaultPurchasePrice: null,
      defaultSellingPrice: "10",
      stock: "20",
      safetyStock: "0",
      bom: [{ componentId, quantity: "1" }],
    });
    expect(productResult.status).toBe(201);
    const productId = productResult.body.id as string;

    const hiddenProductName = `Fast Hidden Scope Product ${suffix}`;
    const hiddenProductResult = await createItem({
      name: hiddenProductName,
      itemType: "product",
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-HIDDEN-SCOPE-${suffix}`,
      category: `Fast Scope ${suffix}`,
      description: "Sellable product with no active sales demand",
      defaultPurchasePrice: null,
      defaultSellingPrice: "10",
      stock: "4",
      safetyStock: "0",
      bom: [{ componentId, quantity: "1" }],
    });
    expect(hiddenProductResult.status).toBe(201);

    const today = new Date().toISOString().slice(0, 10);
    const datedOrder = await createSalesOrder({
      customerId,
      status: "open",
      shipDate: today,
      lines: [{ itemId: productId, quantity: "7", unitPrice: "10" }],
      shipments: plannedShipmentForItems({
        shipDate: today,
        lines: [{ itemId: productId, quantity: "7" }],
      }),
    });
    expect(datedOrder.status).toBe(201);

    const unplannedOrder = await createSalesOrder({
      customerId,
      status: "open",
      shipDate: null,
      lines: [{ itemId: productId, quantity: "5", unitPrice: "10" }],
    });
    expect(unplannedOrder.status).toBe(201);

    await gotoSalesAllocation(page);
    await page.getByLabel("Search sales allocations").fill(suffix);
    await expect(
      page.getByText("Pool vs. demand · 2 orders, 2 short of 2 lines")
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("20/12")).toBeVisible({ timeout: 60_000 });

    await page
      .getByRole("button", { name: /Collapse Unplanned demand/ })
      .click();
    await expect(
      page.getByText("Pool vs. demand · 1 orders, 1 short of 1 lines")
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("20/7")).toBeVisible({ timeout: 60_000 });

    await expect
      .poll(() =>
        page.evaluate(() => {
          const raw = window.localStorage.getItem(
            "ashicore.viewPreferences.sales.orders.allocator",
          );
          return raw ? JSON.parse(raw).unplannedOpen : null;
        }),
      )
      .toBe(false);

    const hiddenMenu = page.getByRole("button", { name: /hidden/ });
    await expect(hiddenMenu).toBeVisible();
    await hiddenMenu.click();
    await expect(page.getByRole("menuitem", { name: new RegExp(hiddenProductName) })).toBeVisible();
    await page.keyboard.press("Escape");
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
      shipDate: null,
      confirmOversell: true,
      lines: [{ itemId: allocationItemId, quantity: "70", unitPrice: "10" }],
    });
    expect(firstOrderResult.status).toBe(201);
    const secondOrderResult = await createSalesOrder({
      customerId: allocationCustomerId,
      status: "open",
      shipDate: null,
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

    await db.insert(stockAllocations).values({
      organizationId: getOrgId(),
      demandType: "sales_order_line",
      demandId: lines[0].id,
      itemId: allocationItemId,
      sourceType: "inventory_lot",
      sourceId: firstLotSource.sourceId,
      quantity: "5",
      status: "active",
      demandLabelSnapshot: null,
      sourceLabelSnapshot: null,
    });

    const firstOrderNumber = await getSalesOrderNumber(firstOrderResult.body.id as string);
    const { response: fallbackLabelResponse, body: fallbackLabelWorkspace } =
      await getSalesAllocationWorkspace(lines[0].id, allocationItemId);
    expect(fallbackLabelResponse.status).toBe(200);
    expect(fallbackLabelWorkspace.assignments[0]).toMatchObject({
      demandLabel: firstOrderNumber,
      salesOrderId: firstOrderResult.body.id,
    });
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
      shipDate: null,
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

  test("lot allocation on a sales order line is honored when shipping a planned shipment", async ({
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
      shipments: plannedShipmentForItems({
        shipDate: "2026-05-18",
        lines: [{ itemId: itemResult.body.id, quantity: "10" }],
      }),
    });
    expect(orderResult.status).toBe(201);

    const [line] = await db
      .select({
        salesOrderLineId: salesShipmentLines.salesOrderLineId,
        shipmentId: salesShipmentLines.salesShipmentId,
      })
      .from(salesShipmentLines)
      .innerJoin(
        salesShipments,
        eq(salesShipmentLines.salesShipmentId, salesShipments.id)
      )
      .where(eq(salesShipments.salesOrderId, orderResult.body.id as string));

    const { response: allocationResponse, body: allocationModel } =
      await getSalesAllocationWorkspace(
        line.salesOrderLineId,
        itemResult.body.id as string
      );
    expect(allocationResponse.status).toBe(200);
    const lotSource = allocationModel.sources.find(
      (source: { sourceType: string }) => source.sourceType === "inventory_lot"
    );
    expect(lotSource).toBeTruthy();

    const { response: lotAllocationResponse } = await saveSalesAllocation({
      lineId: line.salesOrderLineId,
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

    const shipResponse = await testFetch(
      `/api/sales-orders/${orderResult.body.id}/shipments/${line.shipmentId}/ship`,
      { method: "POST" }
    );
    expect(shipResponse.status).toBe(200);

    const [order] = await db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, orderResult.body.id as string));
    expect(order.status).toBe("done");
  });

  test("partial shipment edit keeps sales order line as the allocation target", async ({
    db,
  }) => {
    const suffix = `${ts}-SHIP-FALLBACK-HIDE`;
    const customerResult = await createCustomer({
      name: `Fast Shipment Fallback Customer ${suffix}`,
    });
    expect(customerResult.status).toBe(201);

    const itemResult = await createItem({
      name: `Fast Shipment Fallback Material ${suffix}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FSFH-${ts}`,
      category: `Fast Shipment Fallback ${suffix}`,
      description: "Material for shipment fallback visibility",
      defaultPurchasePrice: "1",
      defaultSellingPrice: "10",
      stock: "10",
      safetyStock: "0",
    });
    expect(itemResult.status).toBe(201);

    const orderResult = await createSalesOrder({
      customerId: customerResult.body.id,
      status: "open",
      shipDate: "2026-05-19",
      lines: [{ itemId: itemResult.body.id, quantity: "10", unitPrice: "10" }],
      shipments: plannedShipmentForItems({
        shipDate: "2026-05-19",
        lines: [{ itemId: itemResult.body.id, quantity: "10" }],
      }),
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

    const editResponse = await testFetch(
      `/api/sales-orders/${orderResult.body.id}/shipments/${shipmentLine.shipmentId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          fulfillmentType: "delivery",
          scheduledDate: "2026-05-19",
          notes: "Partial shipment plan",
          lines: [{ salesOrderLineId: shipmentLine.salesOrderLineId, quantity: "3" }],
        }),
      }
    );
    expect(editResponse.status).toBe(200);

    const shipmentLines = await db
      .select({
        id: salesShipmentLines.id,
        salesOrderLineId: salesShipmentLines.salesOrderLineId,
        scheduledDate: salesShipments.scheduledDate,
        notes: salesShipments.notes,
        quantity: salesShipmentLines.quantity,
      })
      .from(salesShipmentLines)
      .innerJoin(
        salesShipments,
        eq(salesShipmentLines.salesShipmentId, salesShipments.id)
      )
      .where(eq(salesShipments.salesOrderId, orderResult.body.id as string))
      .orderBy(asc(salesShipments.sequence));
    expect(shipmentLines).toEqual([
      expect.objectContaining({
        id: shipmentLine.id,
        scheduledDate: "2026-05-19",
        quantity: "3.0000",
      }),
    ]);

    const workspaceResponse = await testFetch(
      `/api/allocation/workspace?itemId=${itemResult.body.id}`
    );
    expect(workspaceResponse.status).toBe(200);
    const workspace = await workspaceResponse.json();
    const orderDemands = workspace.demands.filter(
      (demand: { demandId: string; demandType: string }) =>
        demand.demandId === shipmentLine.salesOrderLineId ||
        shipmentLines.some((line) => line.id === demand.demandId)
    );

    expect(orderDemands).toEqual(
      [
        expect.objectContaining({
          demandType: "sales_order_line",
          demandId: shipmentLine.salesOrderLineId,
          openQty: "10",
        }),
      ]
    );

    const detailResponse = await testFetch(
      `/api/sales-orders/${orderResult.body.id}`
    );
    expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json();
    expect(detail.fulfillmentSummary.shortQty).toBe("10");
    expect(detail.fulfillmentSummary.label).toBe("Short");
  });

  test("creating a planned shipment keeps allocation on the sales order line", async ({
    db,
  }) => {
    const suffix = `${ts}-SHIP-PULL-UNPLANNED`;
    const customerResult = await createCustomer({
      name: `Fast Shipment Pull Customer ${suffix}`,
    });
    expect(customerResult.status).toBe(201);

    const itemResult = await createItem({
      name: `Fast Shipment Pull Material ${suffix}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FSPU-${ts}`,
      category: `Fast Shipment Pull ${suffix}`,
      description: "Material for unplanned allocation transfer",
      defaultPurchasePrice: "1",
      defaultSellingPrice: "10",
      stock: "10",
      safetyStock: "0",
    });
    expect(itemResult.status).toBe(201);

    const orderResult = await createSalesOrder({
      customerId: customerResult.body.id,
      status: "open",
      shipDate: null,
      lines: [{ itemId: itemResult.body.id, quantity: "8", unitPrice: "10" }],
    });
    expect(orderResult.status).toBe(201);

    const [orderLine] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, orderResult.body.id as string));
    expect(orderLine).toBeTruthy();

    const { response: workspaceResponse, body: allocationModel } =
      await getSalesAllocationWorkspace(
        orderLine.id,
        itemResult.body.id as string,
        "sales_order_line"
      );
    expect(workspaceResponse.status).toBe(200);
    const lotSource = allocationModel.sources.find(
      (source: { sourceType: string }) => source.sourceType === "inventory_lot"
    );
    expect(lotSource).toBeTruthy();

    const { response: saveResponse } = await saveSalesAllocation({
      demandType: "sales_order_line",
      lineId: orderLine.id,
      itemId: itemResult.body.id as string,
      allocations: [
        {
          sourceType: "inventory_lot",
          sourceId: lotSource.sourceId,
          quantity: "8",
        },
      ],
    });
    expect(saveResponse.status).toBe(200);

    const createShipmentResponse = await testFetch(
      `/api/sales-orders/${orderResult.body.id}/shipments`,
      {
        method: "POST",
        body: JSON.stringify({
          fulfillmentType: "delivery",
          scheduledDate: "2026-05-24",
          notes: "Planned after allocation",
          lines: [{ salesOrderLineId: orderLine.id, quantity: "5" }],
        }),
      }
    );
    expect(createShipmentResponse.status).toBe(201);
    const shipment = await createShipmentResponse.json();

    const [shipmentLine] = await db
      .select({ id: salesShipmentLines.id })
      .from(salesShipmentLines)
      .where(eq(salesShipmentLines.salesShipmentId, shipment.id as string));
    expect(shipmentLine).toBeTruthy();

    const activeAllocations = await db
      .select({
        demandType: stockAllocations.demandType,
        demandId: stockAllocations.demandId,
        quantity: stockAllocations.quantity,
      })
      .from(stockAllocations)
      .where(
        and(
          inArray(stockAllocations.demandType, [
            "sales_order_line",
            "sales_shipment_line",
          ]),
          inArray(stockAllocations.demandId, [orderLine.id, shipmentLine.id]),
          eq(stockAllocations.status, "active")
        )
      )
      .orderBy(asc(stockAllocations.demandType), asc(stockAllocations.demandId));

    expect(activeAllocations).toEqual([
      {
        demandType: "sales_order_line",
        demandId: orderLine.id,
        quantity: "8.0000",
      },
    ]);
  });

  test("adding a planned shipment on edit keeps allocation on the sales order line", async ({
    db,
  }) => {
    const suffix = `${ts}-SHIP-DATE-PULL`;
    const customerResult = await createCustomer({
      name: `Fast Ship Date Pull Customer ${suffix}`,
    });
    expect(customerResult.status).toBe(201);

    const itemResult = await createItem({
      name: `Fast Ship Date Pull Material ${suffix}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FSDP-${ts}`,
      category: `Fast Ship Date Pull ${suffix}`,
      description: "Material for default shipment allocation transfer",
      defaultPurchasePrice: "1",
      defaultSellingPrice: "10",
      stock: "10",
      safetyStock: "0",
    });
    expect(itemResult.status).toBe(201);

    const orderResult = await createSalesOrder({
      customerId: customerResult.body.id,
      status: "open",
      orderDate: "2026-05-01",
      shipDate: null,
      requestedDate: null,
      lines: [{ itemId: itemResult.body.id, quantity: "8", unitPrice: "10" }],
    });
    expect(orderResult.status).toBe(201);

    const [initialLine] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, orderResult.body.id as string));
    expect(initialLine).toBeTruthy();

    const { response: workspaceResponse, body: allocationModel } =
      await getSalesAllocationWorkspace(
        initialLine.id,
        itemResult.body.id as string,
        "sales_order_line"
      );
    expect(workspaceResponse.status).toBe(200);
    const lotSource = allocationModel.sources.find(
      (source: { sourceType: string }) => source.sourceType === "inventory_lot"
    );
    expect(lotSource).toBeTruthy();

    const { response: saveResponse } = await saveSalesAllocation({
      demandType: "sales_order_line",
      lineId: initialLine.id,
      itemId: itemResult.body.id as string,
      allocations: [
        {
          sourceType: "inventory_lot",
          sourceId: lotSource.sourceId,
          quantity: "8",
        },
      ],
    });
    expect(saveResponse.status).toBe(200);

    const updateResult = await updateSalesOrder(orderResult.body.id as string, {
      customerId: customerResult.body.id,
      status: "open",
      orderDate: "2026-05-01",
      shipDate: "2026-05-24",
      requestedDate: null,
      notes: "Shipment added after allocation",
      lines: [{ itemId: itemResult.body.id, quantity: "8", unitPrice: "10" }],
      shipments: plannedShipmentForItems({
        shipDate: "2026-05-24",
        lines: [{ itemId: itemResult.body.id, quantity: "8" }],
      }),
    });
    expect(updateResult.status).toBe(200);

    const [shipmentLine] = await db
      .select({
        id: salesShipmentLines.id,
        salesOrderLineId: salesShipmentLines.salesOrderLineId,
        quantity: salesShipmentLines.quantity,
      })
      .from(salesShipmentLines)
      .innerJoin(
        salesShipments,
        eq(salesShipmentLines.salesShipmentId, salesShipments.id)
      )
      .where(eq(salesShipments.salesOrderId, orderResult.body.id as string));
    expect(shipmentLine).toBeTruthy();
    expect(shipmentLine.quantity).toBe("8.0000");

    const activeAllocations = await db
      .select({
        demandType: stockAllocations.demandType,
        demandId: stockAllocations.demandId,
        quantity: stockAllocations.quantity,
      })
      .from(stockAllocations)
      .where(
        and(
          inArray(stockAllocations.demandType, [
            "sales_order_line",
            "sales_shipment_line",
          ]),
          inArray(stockAllocations.demandId, [
            initialLine.id,
            shipmentLine.salesOrderLineId,
            shipmentLine.id,
          ]),
          eq(stockAllocations.status, "active")
        )
      );

    expect(activeAllocations).toEqual([
      {
        demandType: "sales_order_line",
        demandId: shipmentLine.salesOrderLineId,
        quantity: "8.0000",
      },
    ]);
  });

  test("planned shipment edits preserve unchanged sales order line allocations", async ({
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
      shipments: plannedShipmentForItems({
        shipDate: "2026-05-20",
        lines: [{ itemId: itemResult.body.id, quantity: "6" }],
      }),
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
        shipmentLine.salesOrderLineId,
        itemResult.body.id as string
      );
    expect(workspaceResponse.status).toBe(200);
    const lotSource = allocationModel.sources.find(
      (source: { sourceType: string }) => source.sourceType === "inventory_lot"
    );
    expect(lotSource).toBeTruthy();

    const { response: saveResponse } = await saveSalesAllocation({
      lineId: shipmentLine.salesOrderLineId,
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
    expect(activeAllocations).toEqual([]);
    const orderLineAllocations = await db
      .select({
        demandId: stockAllocations.demandId,
        quantity: stockAllocations.quantity,
        status: stockAllocations.status,
      })
      .from(stockAllocations)
      .where(
        and(
          eq(stockAllocations.demandType, "sales_order_line"),
          eq(stockAllocations.demandId, shipmentLine.salesOrderLineId)
        )
      );
    expect(orderLineAllocations).toEqual([
      {
        demandId: shipmentLine.salesOrderLineId,
        quantity: "4.0000",
        status: "active",
      },
    ]);
  });

  test("manufacturing output allocation follows sales order line demand", async ({
    db,
  }) => {
    const suffix = `${ts}-MO-ALLOC`;
    const customerResult = await createCustomer({
      name: `Fast MO Allocation Customer ${suffix}`,
    });
    expect(customerResult.status).toBe(201);

    const materialResult = await createItem({
      name: `Fast MO Allocation Material ${suffix}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-MO-ALLOC-MAT-${suffix}`,
      category: `Fast MO Allocation ${suffix}`,
      description: "Material for output allocation bucket regression",
      defaultPurchasePrice: "1",
      defaultSellingPrice: null,
      stock: "20",
      safetyStock: "0",
      bom: [],
    });
    expect(materialResult.status).toBe(201);
    const materialId = materialResult.body.id as string;

    const productResult = await createItem({
      name: `Fast MO Allocation Product ${suffix}`,
      itemType: "product",
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-MO-ALLOC-PROD-${suffix}`,
      category: `Fast MO Allocation ${suffix}`,
      description: "Product for output allocation bucket regression",
      defaultPurchasePrice: null,
      defaultSellingPrice: "10",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: materialId, quantity: "1" }],
    });
    expect(productResult.status).toBe(201);
    const productId = productResult.body.id as string;

    const orderResult = await createSalesOrder({
      customerId: customerResult.body.id as string,
      status: "open",
      requestedDate: "2026-06-10",
      lines: [{ itemId: productId, quantity: "5", unitPrice: "10" }],
      shipments: plannedShipmentForItems({
        shipDate: "2026-06-10",
        lines: [{ itemId: productId, quantity: "5" }],
      }),
    });
    expect(orderResult.status).toBe(201);
    const orderId = orderResult.body.id as string;

    const [salesLine] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, orderId));
    expect(salesLine?.id).toBeTruthy();

    const [shipmentLine] = await db
      .select({
        id: salesShipmentLines.id,
        quantity: salesShipmentLines.quantity,
      })
      .from(salesShipmentLines)
      .innerJoin(
        salesShipments,
        eq(salesShipmentLines.salesShipmentId, salesShipments.id)
      )
      .where(eq(salesShipments.salesOrderId, orderId));
    expect(shipmentLine).toMatchObject({ quantity: "5.0000" });

    const sourceMo = await createManufacturingOrder({
      productId,
      plannedQuantity: "5",
      ingredients: [{ itemId: materialId, quantityPerUnit: "1" }],
    });
    expect(sourceMo.status).toBe(201);
    const sourceMoId = sourceMo.body.id as string;

    const allocationResponse = await testFetch(
      `/api/manufacturing-orders/${sourceMoId}/output-allocation`,
      {
        method: "PUT",
        body: JSON.stringify({
          salesAllocations: [{ salesOrderLineId: salesLine.id, quantity: "5" }],
          productionAllocations: [],
        }),
      }
    );
    expect(allocationResponse.status).toBe(200);

    const promiseRows = await db
      .select({
        demandType: stockAllocations.demandType,
        demandId: stockAllocations.demandId,
        quantity: stockAllocations.quantity,
      })
      .from(stockAllocations)
      .where(
        and(
          eq(stockAllocations.itemId, productId),
          eq(stockAllocations.sourceType, "manufacturing_order"),
          eq(stockAllocations.sourceId, sourceMoId),
          eq(stockAllocations.status, "active")
        )
      );
    expect(promiseRows).toEqual([
      {
        demandType: "sales_order_line",
        demandId: salesLine.id,
        quantity: "5.0000",
      },
    ]);

    const [ingredient] = await db
      .select({ id: manufacturingOrderIngredients.id })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, sourceMoId));
    expect(ingredient?.id).toBeTruthy();
    const pickResponse = await testFetch(
      `/api/manufacturing-orders/${sourceMoId}/ingredients/${ingredient.id}/pick`,
      { method: "POST", body: JSON.stringify({}) }
    );
    expect(pickResponse.status).toBe(200);

    const completeResponse = await completeManufacturingOrder(sourceMoId, "5");
    expect(completeResponse.status).toBe(200);

    const materializedRows = await db
      .select({
        demandType: stockAllocations.demandType,
        demandId: stockAllocations.demandId,
        sourceType: stockAllocations.sourceType,
        quantity: stockAllocations.quantity,
      })
      .from(stockAllocations)
      .where(
        and(
          eq(stockAllocations.itemId, productId),
          eq(stockAllocations.status, "active")
        )
      );
    expect(materializedRows).toEqual([
      {
        demandType: "sales_order_line",
        demandId: salesLine.id,
        sourceType: "inventory_lot",
        quantity: "5.0000",
      },
    ]);
  });

  test("decreasing a planned shipment line leaves sales order allocation unchanged", async ({
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
      shipments: plannedShipmentForItems({
        shipDate: "2026-05-22",
        lines: [{ itemId: itemResult.body.id, quantity: "6" }],
      }),
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
        shipmentLine.salesOrderLineId,
        itemResult.body.id as string
      );
    expect(workspaceResponse.status).toBe(200);
    const lotSource = allocationModel.sources.find(
      (source: { sourceType: string }) => source.sourceType === "inventory_lot"
    );
    expect(lotSource).toBeTruthy();

    const { response: saveResponse } = await saveSalesAllocation({
      lineId: shipmentLine.salesOrderLineId,
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
        demandType: stockAllocations.demandType,
        demandId: stockAllocations.demandId,
        quantity: stockAllocations.quantity,
        status: stockAllocations.status,
      })
      .from(stockAllocations)
      .where(
        and(
          inArray(stockAllocations.demandType, [
            "sales_order_line",
            "sales_shipment_line",
          ]),
          inArray(stockAllocations.demandId, [
            shipmentLine.id,
            shipmentLine.salesOrderLineId,
          ])
        )
      )
      .orderBy(asc(stockAllocations.demandType), asc(stockAllocations.demandId));
    expect(allocationRows).toEqual([
      {
        demandType: "sales_order_line",
        demandId: shipmentLine.salesOrderLineId,
        quantity: "6.0000",
        status: "active",
      },
    ]);
  });

  test("sales order line MO allocation cannot ship from unrelated FIFO stock", async ({
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
      shipments: plannedShipmentForItems({
        shipDate: "2026-05-23",
        lines: [{ itemId: itemResult.body.id, quantity: "2" }],
      }),
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
      demandType: "sales_order_line",
      demandId: shipmentLine.salesOrderLineId,
      itemId: itemResult.body.id as string,
      sourceType: "manufacturing_order",
      sourceId: mo.id,
      quantity: "2",
      status: "active",
      demandLabelSnapshot: "Shipment MO allocation",
      sourceLabelSnapshot: "MO waiting on output",
    });
    await db
      .update(salesOrderLines)
      .set({ allocationManagedAt: new Date() })
      .where(eq(salesOrderLines.id, shipmentLine.salesOrderLineId));

    const shipResponse = await testFetch(
      `/api/sales-orders/${orderResult.body.id}/shipments/${shipmentLine.shipmentId}/ship`,
      { method: "POST" }
    );
    expect(shipResponse.status).toBe(409);
  });

  test("sales-order lot allocation can ship when item is fully committed", async ({
    db,
  }) => {
    const suffix = `${ts}-SHIP-LOT-HELD`;
    const customerResult = await createCustomer({
      name: `Fast Shipment Held Lot Customer ${suffix}`,
    });
    expect(customerResult.status).toBe(201);

    const itemResult = await createItem({
      name: `Fast Shipment Held Lot Product ${suffix}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FSHL-${ts}`,
      category: `Fast Shipment Held Lot ${suffix}`,
      description: "Material for shipment-held lot allocation",
      defaultPurchasePrice: "1",
      defaultSellingPrice: "10",
      stock: "150",
      safetyStock: "0",
    });
    expect(itemResult.status).toBe(201);
    const itemId = itemResult.body.id as string;

    const competingOrderResult = await createSalesOrder({
      customerId: customerResult.body.id,
      status: "open",
      shipDate: "2026-05-20",
      lines: [{ itemId, quantity: "150", unitPrice: "10" }],
    });
    expect(competingOrderResult.status).toBe(201);

    const orderResult = await createSalesOrder({
      customerId: customerResult.body.id,
      status: "open",
      shipDate: "2026-05-21",
      lines: [{ itemId, quantity: "50", unitPrice: "10" }],
      shipments: plannedShipmentForItems({
        shipDate: "2026-05-21",
        lines: [{ itemId, quantity: "50" }],
      }),
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

    const [lot] = await db
      .select({ id: lots.id })
      .from(lots)
      .where(eq(lots.itemId, itemId))
      .orderBy(asc(lots.receivedAt), asc(lots.id));
    expect(lot).toBeTruthy();

    await db.insert(stockAllocations).values({
      organizationId: getOrgId(),
      demandType: "sales_order_line",
      demandId: shipmentLine.salesOrderLineId,
      itemId,
      sourceType: "inventory_lot",
      sourceId: lot.id,
      quantity: "50",
      status: "active",
      demandLabelSnapshot: "Shipment held lot allocation",
      sourceLabelSnapshot: "Held inventory lot",
    });
    await db
      .update(salesOrderLines)
      .set({ allocationManagedAt: new Date() })
      .where(eq(salesOrderLines.id, shipmentLine.salesOrderLineId));

    const shipResponse = await testFetch(
      `/api/sales-orders/${orderResult.body.id}/shipments/${shipmentLine.shipmentId}/ship`,
      { method: "POST" }
    );
    expect(shipResponse.status).toBe(200);

    const activeAllocationRows = await db
      .select({ status: stockAllocations.status })
      .from(stockAllocations)
      .where(
        and(
          eq(stockAllocations.demandType, "sales_shipment_line"),
          eq(stockAllocations.demandId, shipmentLine.id)
        )
      );
    expect(activeAllocationRows).toEqual([]);
    const orderAllocationRows = await db
      .select({ status: stockAllocations.status })
      .from(stockAllocations)
      .where(
        and(
          eq(stockAllocations.demandType, "sales_order_line"),
          eq(stockAllocations.demandId, shipmentLine.salesOrderLineId)
        )
      );
    expect(orderAllocationRows).toEqual([{ status: "consumed" }]);
  });

  test("keeps same-date sales order rows in place after confirming from the list", async ({
    page,
    db,
  }) => {
    test.slow();

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
      sellable: true,
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
      sellable: true,
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
      orderDate: "2026-06-01",
      shipDate: "2026-06-02",
      requestedDate: "2026-06-05",
      lines: [
        { itemId: firstProductId, quantity: "2", unitPrice: "10" },
        { itemId: secondProductId, quantity: "3", unitPrice: "10" },
      ],
      shipments: plannedShipmentForItems({
        shipDate: "2026-06-02",
        deliveryDate: "2026-06-05",
        lines: [
          { itemId: firstProductId, quantity: "2" },
          { itemId: secondProductId, quantity: "3" },
        ],
      }),
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
        id: manufacturingOrders.id,
        salesOrderLineId: manufacturingOrders.salesOrderLineId,
        productId: manufacturingOrders.productId,
        plannedDate: manufacturingOrders.plannedDate,
      })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.salesOrderId, fulfillmentOrderId));
    expect(createdManufacturingOrders).toHaveLength(1);
    const [createdManufacturingOrder] = createdManufacturingOrders;
    if (!createdManufacturingOrder) {
      throw new Error("Expected a manufacturing order for the selected line.");
    }
    expect(createdManufacturingOrders).toEqual([
      {
        id: createdManufacturingOrder.id,
        salesOrderLineId: selectedLineId,
        productId: firstProductId,
        plannedDate: "2026-06-02",
      },
    ]);

    await db
      .update(manufacturingOrders)
      .set({ salesOrderLineId: null })
      .where(eq(manufacturingOrders.id, createdManufacturingOrder.id));

    const deleteResponse = await testFetch(`/api/sales-orders/${fulfillmentOrderId}`, {
      method: "DELETE",
    });
    const deleteBody = await deleteResponse.json();
    expect(deleteResponse.status).toBe(400);
    expect(deleteBody.error).toContain("linked to the order but not to a matching active sales line");

    const [stillVisibleOrder] = await db
      .select({ deletedAt: salesOrders.deletedAt })
      .from(salesOrders)
      .where(eq(salesOrders.id, fulfillmentOrderId));
    expect(stillVisibleOrder.deletedAt).toBeNull();
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
      sellable: true,
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

    const batchMaterialResult = await createItem({
      name: `Fast Batch Potential Material ${suffix}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-BATCH-POT-MAT-${suffix}`,
      category: `Fast Aged Potential ${suffix}`,
      description: "Material for BOM-basis potential regression",
      defaultPurchasePrice: "1",
      defaultSellingPrice: null,
      stock: "9",
      safetyStock: "0",
      bom: [],
    });
    expect(batchMaterialResult.status).toBe(201);
    const batchMaterialId = batchMaterialResult.body.id as string;

    const batchProductResult = await createItem({
      name: `Fast Batch Potential Product ${suffix}`,
      itemType: "product",
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-BATCH-POT-PROD-${suffix}`,
      category: `Fast Aged Potential ${suffix}`,
      description: "Product whose potential is driven by BOM batch basis",
      defaultPurchasePrice: null,
      defaultSellingPrice: "10",
      stock: "0",
      safetyStock: "0",
      manufacturingMode: "batch",
      expectedBatchYield: "9",
      bom: [
        {
          componentId: batchMaterialId,
          quantity: "3",
        },
      ],
    });
    expect(batchProductResult.status).toBe(201);
    const batchProductId = batchProductResult.body.id as string;

    const orderResult = await createSalesOrder({
      customerId,
      status: "open",
      lines: [{ itemId: constrainedProductId, quantity: "1", unitPrice: "10" }],
    });
    expect(orderResult.status).toBe(201);
    const constrainedOrderId = orderResult.body.id as string;

    const productsResponse = await testFetch("/api/items?itemType=product");
    expect(productsResponse.status).toBe(200);
    const products = (await productsResponse.json()) as Array<{
      id: string;
      potential: string | null;
    }>;
    expect(products.find((product) => product.id === constrainedProductId)).toMatchObject({
      potential: "0",
    });
    expect(products.find((product) => product.id === batchProductId)).toMatchObject({
      potential: "27",
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
      "/api/items?itemType=product"
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

    const soldEvents = await db
      .select({
        quantity: inventoryEvents.quantity,
        unitCost: inventoryEvents.unitCost,
        extendedCost: inventoryEvents.extendedCost,
      })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, materialId),
          eq(inventoryEvents.eventType, "sales_consumption"),
          sql`${inventoryEvents.metadata}->>'salesOrderId' = ${marginOrderId}`
        )
      )
      .orderBy(asc(inventoryEvents.unitCost));

    expect(soldEvents).toHaveLength(2);
    expect(soldEvents.map((event) => Number(event.quantity))).toEqual([1, 1]);
    expect(soldEvents.map((event) => Number(event.unitCost))).toEqual([10, 20]);
    expect(soldEvents.map((event) => Number(event.extendedCost))).toEqual([10, 20]);
  });

  test("keeps sales stocked-subassembly estimates separate from inventory recipe margin", async () => {
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
      sellable: true,
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
      sellable: true,
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

    const productsResponse = await testFetch("/api/items?itemType=product");
    expect(productsResponse.status).toBe(200);
    const products = (await productsResponse.json()) as Array<{
      id: string;
      estimatedUnitCost: string | null;
      marginPercent: string | null;
    }>;
    const finishedProduct = products.find((product) => product.id === finishedId);
    expect(finishedProduct).toMatchObject({
      estimatedUnitCost: "10",
      marginPercent: "50",
    });
  });

  test("applies recipe output quantity to estimated product margin", async () => {
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
      sellable: true,
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
      bom: [
        {
          componentId: materialId,
          quantity: "2",
        },
      ],
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

    const productsResponse = await testFetch("/api/items?itemType=product");
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

  test("spreads batch packaging across estimated product unit cost", async () => {
    const suffix = `${ts}-GROUP-MARGIN`;
    const materialResult = await createItem({
      name: `Fast Group Margin Material ${suffix}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FGM-MAT-${suffix}`,
      category: `Fast Group Margin ${suffix}`,
      description: "Material for batch estimated margin",
      defaultPurchasePrice: "2",
      defaultSellingPrice: null,
      stock: "1",
      safetyStock: "0",
      bom: [],
    });
    expect(materialResult.status).toBe(201);
    const materialId = materialResult.body.id as string;

    const palletResult = await createItem({
      name: `Fast Group Margin Pallet ${suffix}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FGM-PAL-${suffix}`,
      category: `Fast Group Margin ${suffix}`,
      description: "Batch packaging for estimated margin",
      defaultPurchasePrice: "50",
      defaultSellingPrice: null,
      stock: "1",
      safetyStock: "0",
      bom: [],
    });
    expect(palletResult.status).toBe(201);
    const palletId = palletResult.body.id as string;

    const productResult = await createItem({
      name: `Fast Group Margin Product ${suffix}`,
      itemType: "product",
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FGM-PROD-${suffix}`,
      category: `Fast Group Margin ${suffix}`,
      description: "Batch product for estimated margin",
      defaultPurchasePrice: null,
      defaultSellingPrice: "20",
      stock: "0",
      safetyStock: "0",
      manufacturingMode: "batch",
      expectedBatchYield: "50",
      bom: [
        { componentId: materialId, quantity: "100" },
        {
          componentId: palletId,
          quantity: "1",
        },
      ],
    });
    expect(productResult.status).toBe(201);
    const productId = productResult.body.id as string;

    const pricingResponse = await testFetch("/api/sales-orders/price", {
      method: "POST",
      body: JSON.stringify({
        customerId,
        itemId: productId,
        quantity: "1",
      }),
    });
    expect(pricingResponse.status).toBe(200);
    const pricing = await pricingResponse.json();
    expect(pricing.estimatedUnitCost).toBe("5");
  });

  test("estimates operation-only product cost", async () => {
    const suffix = `${ts}-OP-ONLY-MARGIN`;
    const customerResult = await createCustomer({
      name: `Fast Operation Only Customer ${suffix}`,
      email: null,
      phone: null,
      notes: null,
    });
    expect(customerResult.status).toBe(201);
    const operationOnlyCustomerId = customerResult.body.id as string;

    const resource = await testFetch("/api/manufacturing-resources", {
      method: "POST",
      body: JSON.stringify({
        name: `Fast Operation Only Crew ${suffix}`,
        description: null,
        resourceType: "labor",
        loadedCostPerHour: "100",
      }),
    });
    expect(resource.status).toBe(201);
    const resourceBody = await resource.json();
    const resourceId = resourceBody.id as string;

    const productResult = await createItem({
      name: `Fast Operation Only Product ${suffix}`,
      itemType: "product",
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FOO-PROD-${suffix}`,
      category: `Fast Operation Only ${suffix}`,
      description: "Operation-only product for estimated margin",
      defaultPurchasePrice: null,
      defaultSellingPrice: "25",
      stock: "0",
      safetyStock: "0",
      standardCostQuantity: "10",
      bom: [],
      operationCosts: [
        {
          operationName: "Operation-only setup",
          resourceId,
          costScalingMode: "fixed_per_mo",
          crewSize: "1",
          plannedMinutes: "60",
        },
      ],
    });
    expect(productResult.status).toBe(201);
    const productId = productResult.body.id as string;

    const pricingResponse = await testFetch("/api/sales-orders/price", {
      method: "POST",
      body: JSON.stringify({
        customerId: operationOnlyCustomerId,
        itemId: productId,
        quantity: "1",
      }),
    });
    expect(pricingResponse.status).toBe(200);
    const pricing = await pricingResponse.json();
    expect(pricing.estimatedUnitCost).toBe("10");
  });

  test("creates sales-linked MOs for whole batch output", async ({
    db,
  }) => {
    const suffix = `${ts}-SALES-GROUP-MO`;
    const materialResult = await createItem({
      name: `Fast Sales Group Soil ${suffix}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FSGM-SOIL-${suffix}`,
      category: `Fast Sales Group MO ${suffix}`,
      description: null,
      defaultPurchasePrice: "1",
      defaultSellingPrice: null,
      stock: "500",
      safetyStock: "0",
      bom: [],
    });
    expect(materialResult.status).toBe(201);
    const materialId = materialResult.body.id as string;

    const palletResult = await createItem({
      name: `Fast Sales Group Pallet ${suffix}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FSGM-PALLET-${suffix}`,
      category: `Fast Sales Group MO ${suffix}`,
      description: null,
      defaultPurchasePrice: "5",
      defaultSellingPrice: null,
      stock: "50",
      safetyStock: "0",
      bom: [],
    });
    expect(palletResult.status).toBe(201);
    const palletId = palletResult.body.id as string;

    const productResult = await createItem({
      name: `Fast Sales Group Product ${suffix}`,
      itemType: "product",
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FSGM-PROD-${suffix}`,
      category: `Fast Sales Group MO ${suffix}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "12",
      stock: "0",
      safetyStock: "0",
      manufacturingMode: "batch",
      expectedBatchYield: "50",
      bom: [
        {
          componentId: materialId,
          quantity: "1",
        },
        {
          componentId: palletId,
          quantity: "1",
        },
      ],
    });
    expect(productResult.status).toBe(201);
    const productIdForSalesGroup = productResult.body.id as string;

    const orderResult = await createSalesOrder({
      customerId,
      status: "open",
      confirmOversell: true,
      lines: [{ itemId: productIdForSalesGroup, quantity: "52", unitPrice: "12" }],
    });
    expect(orderResult.status).toBe(201);
    const groupOrderId = orderResult.body.id as string;

    const previewResponse = await testFetch(
      `/api/sales-orders/${groupOrderId}/manufacturing-orders`
    );
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json();
    const line = preview.lines.find(
      (candidate: { itemId: string }) =>
        candidate.itemId === productIdForSalesGroup
    );
    expect(line).toBeTruthy();
    const fallbackResponse = await testFetch(
      `/api/sales-orders/${groupOrderId}/manufacturing-orders`,
      {
        method: "POST",
        body: JSON.stringify({
          plannedDate: null,
          salesOrderLineIds: [line.salesOrderLineId],
          priorityRank: null,
          lineQuantities: [
            { salesOrderLineId: line.salesOrderLineId, quantity: "100" },
          ],
          notes: null,
        }),
      }
    );
    expect(fallbackResponse.status).toBe(201);
    const fallbackBody = await fallbackResponse.json();
    const fallbackMoId = fallbackBody.created[0].manufacturingOrderId as string;
    const fallbackIngredientRows = await db
      .select()
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, fallbackMoId));
    const fallbackTotalByItemId = sumPlannedQuantityByItemId(fallbackIngredientRows);
    expect(fallbackTotalByItemId.get(materialId)).toBe("2.0000");
    expect(fallbackTotalByItemId.get(palletId)).toBe("2.0000");

    const secondOrderResult = await createSalesOrder({
      customerId,
      status: "open",
      confirmOversell: true,
      lines: [{ itemId: productIdForSalesGroup, quantity: "52", unitPrice: "12" }],
    });
    expect(secondOrderResult.status).toBe(201);
    const secondGroupOrderId = secondOrderResult.body.id as string;

    const secondPreviewResponse = await testFetch(
      `/api/sales-orders/${secondGroupOrderId}/manufacturing-orders`
    );
    expect(secondPreviewResponse.status).toBe(200);
    const secondPreview = await secondPreviewResponse.json();
    const secondLine = secondPreview.lines.find(
      (candidate: { itemId: string }) =>
        candidate.itemId === productIdForSalesGroup
    );
    expect(secondLine).toBeTruthy();

    const createResponse = await testFetch(
      `/api/sales-orders/${secondGroupOrderId}/manufacturing-orders`,
      {
        method: "POST",
        body: JSON.stringify({
          plannedDate: null,
          salesOrderLineIds: [secondLine.salesOrderLineId],
          priorityRank: null,
          lineQuantities: [
            { salesOrderLineId: secondLine.salesOrderLineId, quantity: "100" },
          ],
          notes: null,
        }),
      }
    );
    expect(createResponse.status).toBe(201);

    const [createdMo] = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.salesOrderLineId, secondLine.salesOrderLineId));
    expect(createdMo).toBeTruthy();

    const ingredientRows = await db
      .select()
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, createdMo.id));
    const totalByItemId = sumPlannedQuantityByItemId(ingredientRows);
    expect(createdMo.plannedQuantity).toBe("100.0000");
    expect(createdMo.numberOfBatches).toBe(2);
    expect(totalByItemId.get(materialId)).toBe("2.0000");
    expect(totalByItemId.get(palletId)).toBe("2.0000");
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
      sellable: true,
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
      sellable: true,
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
    await page.getByRole("button", { name: "More actions" }).click();
    await page
      .getByRole("menuitem", { name: "Create manufacturing order(s)" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Create Manufacturing Orders" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(productTwoName);
    await expect(dialog).toContainText("1 order");
    await selectDate(page, dialog.getByLabel("Planned Date"), "2026-05-22");
    await expect(dialog.getByRole("button", { name: "Create 1 order" })).toBeEnabled();
  });

  test("creates MOs for unallocated finished goods stock", async ({
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
      sellable: true,
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
        quantity: "3",
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
      sellable: true,
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
      shipments: plannedShipmentForItems({
        shipDate: "2026-04-15",
        lines: [{ itemId: webShipProductId, quantity: "2" }],
      }),
    });
    expect(orderResult.status).toBe(201);
    const webShipOrderId = orderResult.body.id as string;

    await page.goto(`/sales/orders/${webShipOrderId}`);
    const shipmentRow = page.getByRole("row", { name: /PLANNED/ });
    await shipmentRow.getByRole("button", { name: /Actions for/ }).click();
    await page.getByRole("menuitem", { name: "Mark as shipped" }).click();

    const dialog = page.getByRole("alertdialog", { name: "Mark shipment shipped?" });
    await expect(dialog).toBeVisible();
    const shipResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes(`/api/sales-orders/${webShipOrderId}/shipments/`) &&
        response.url().endsWith("/ship")
    );
    await dialog.getByRole("button", { name: "Mark shipped" }).click();
    expect((await shipResponsePromise).status()).toBe(200);

    const [shippedOrder] = await db
      .select({ status: salesOrders.status, shippedAt: salesOrders.shippedAt })
      .from(salesOrders)
      .where(eq(salesOrders.id, webShipOrderId));
    expect(shippedOrder.status).toBe("done");
    expect(shippedOrder.shippedAt).not.toBeNull();

    const [shippedShipment] = await db
      .select({
        id: salesShipments.id,
        status: salesShipments.status,
        shippedAt: salesShipments.shippedAt,
      })
      .from(salesShipments)
      .where(eq(salesShipments.salesOrderId, webShipOrderId));
    expect(shippedShipment.status).toBe("shipped");
    expect(shippedShipment.shippedAt).not.toBeNull();

    const [consumptionEvent] = await db
      .select({ id: inventoryEvents.id })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.eventType, "sales_consumption"),
          eq(inventoryEvents.referenceType, "sales_shipment"),
          eq(inventoryEvents.referenceId, shippedShipment.id)
        )
      )
      .limit(1);
    expect(consumptionEvent).toBeDefined();

    await db
      .update(salesOrders)
      .set({ status: "open", shippedAt: null })
      .where(eq(salesOrders.id, webShipOrderId));
    await db
      .update(salesShipments)
      .set({ status: "planned", shippedAt: null })
      .where(eq(salesShipments.salesOrderId, webShipOrderId));

    const openOrderResult = await createSalesOrder({
      customerId: webShipCustomerId,
      status: "open",
      lines: [{ itemId: webShipProductId, quantity: "1", unitPrice: "10" }],
    });
    expect(openOrderResult.status).toBe(201);
    const openOrderId = openOrderResult.body.id as string;

    const deleteResponse = await page.request.delete("/api/sales-orders", {
      data: { ids: [webShipOrderId, openOrderId] },
      headers: {
        "Idempotency-Key": `test:sales-bulk-delete:${Date.now()}`,
      },
    });
    const deleteText = await deleteResponse.text();
    expect(deleteResponse.status(), deleteText).toBe(400);
    const deleteBody = JSON.parse(deleteText);
    expect(deleteBody.error).toContain("inventory has already been consumed");

    const [blockedOrder] = await db
      .select({ deletedAt: salesOrders.deletedAt })
      .from(salesOrders)
      .where(eq(salesOrders.id, webShipOrderId));
    expect(blockedOrder.deletedAt).toBeNull();

    const [untouchedOpenOrder] = await db
      .select({ deletedAt: salesOrders.deletedAt })
      .from(salesOrders)
      .where(eq(salesOrders.id, openOrderId));
    expect(untouchedOpenOrder.deletedAt).toBeNull();
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
        shipments: plannedShipmentForItems({
          shipDate: "2026-04-23",
          lines: [{ itemId: itemResult.body.id, quantity: "8" }],
        }),
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

    const remainderShipments = await db
      .select({ id: salesShipments.id, scheduledDate: salesShipments.scheduledDate })
      .from(salesShipments)
      .where(
        and(
          eq(salesShipments.salesOrderId, shortOrderId),
          sql`${salesShipments.id} <> ${initialPlannedShipment.id}`
        )
      );
    expect(remainderShipments).toHaveLength(0);

    const workspaceResponse = await testFetch(
      `/api/allocation/workspace?demandType=sales_order_line&demandId=${line.id}&itemId=${itemResult.body.id}`
    );
    expect(workspaceResponse.status).toBe(200);
    const workspace = await workspaceResponse.json();
    expect(workspace.primaryDemand).toEqual(
      expect.objectContaining({
        demandType: "sales_order_line",
        demandId: line.id,
        openQty: "4",
      })
    );

    const shipResponse = await testFetch(
      `/api/sales-orders/${shortOrderId}/shipments/${initialPlannedShipment.id}/ship`,
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
        shipments: plannedShipmentForItems({
          shipDate: "2026-04-24",
          lines: [{ itemId: itemResult.body.id, quantity: "4" }],
        }),
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
