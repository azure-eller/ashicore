import { asc, eq, inArray } from "drizzle-orm";
import { test, expect, filterList, getIdFromUrl, selectDate } from "../fixtures";
import {
  inventoryItemBalances,
  inventoryLotBalances,
  lots,
  manufacturingOrders,
  purchaseOrderLines,
  salesOrderLines,
  salesOrders,
  salesShipments,
  customers as salesCustomers,
} from "../../../lib/db/schema";
import {
  createCustomer,
  createItem,
  createPurchaseOrder,
  createSalesOrder,
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

    await selectDate(page, page.getByLabel("Order Date"), "2026-04-01");
    await selectDate(page, page.getByLabel("Delivery Date"), "2026-04-15");

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
    await expect(
      page.getByRole("heading", { level: 1, name: /SO-\d{4}-\d{4}/ })
    ).toBeVisible({ timeout: 15_000 });

    const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, orderId));
    expect(order.customerId).toBe(customerId);
    expect(order.customerName).toBe(customerName);
    expect(order.status).toBe("draft");
    expect(order.orderDate).toBe("2026-04-01");
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
    await filterList(page, "Search orders", order.orderNumber);

    const orderRow = page.getByRole("row", { name: new RegExp(order.orderNumber) });
    await orderRow.getByRole("button", { name: "Expand order" }).click();

    const expandedLine = page.getByRole("row", {
      name: new RegExp(`${materialName}.*${materialSku}`),
    }).last();
    const cells = expandedLine.getByRole("cell");
    await expect(cells.nth(3)).toHaveText("150");
    await expect(cells.nth(4)).toHaveText("0");
    await expect(cells.nth(5)).toHaveText("150");
    await expect(expandedLine).not.toContainText("-200");
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
    await expect(
      page.getByRole("row", { name: new RegExp(firstOrderNumber) })
    ).toBeVisible();
    await expect(
      page.getByRole("row", { name: new RegExp(secondOrderNumber) })
    ).toBeVisible();

    const getSameDatePositions = () =>
      page.locator("tbody tr").evaluateAll(
        (rows, orderNumbers) =>
          (orderNumbers as string[]).map((orderNumber) =>
            rows.findIndex((row) => row.textContent?.includes(orderNumber))
          ),
        orderNumbers
      );

    const beforeConfirm = await getSameDatePositions();
    expect(beforeConfirm).toEqual([0, 1]);

    await page
      .getByRole("row", { name: new RegExp(firstOrderNumber) })
      .getByRole("button", { name: "Confirm" })
      .click();
    await expect(
      page.getByRole("row", { name: new RegExp(firstOrderNumber) })
    ).toContainText("Confirmed", { timeout: 15_000 });

    await expect
      .poll(getSameDatePositions, { timeout: 15_000 })
      .toEqual(beforeConfirm);
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
    db,
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

    const [order] = await db
      .select({ orderNumber: salesOrders.orderNumber })
      .from(salesOrders)
      .where(eq(salesOrders.id, partialMoOrderId));

    await page.goto("/sales/orders");
    await filterList(page, "Search orders", order.orderNumber);

    const orderRow = page.getByRole("row", { name: new RegExp(order.orderNumber) });
    await orderRow.getByRole("button", { name: "Create MOs" }).click();
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
    await filterList(page, "Search orders", order.orderNumber);

    const orderRow = page.getByRole("row", { name: new RegExp(order.orderNumber) });
    await expect(orderRow.getByRole("button", { name: "Create MOs" })).toHaveCount(0);
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
});
