import { asc, eq } from "drizzle-orm";
import { test, expect, filterList, getIdFromUrl, selectDate } from "../fixtures";
import {
  inventoryItemBalances,
  inventoryLotBalances,
  lots,
  purchaseOrderLines,
  salesOrderLines,
  salesOrders,
  customers as salesCustomers,
} from "../../../lib/db/schema";
import {
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
    await selectDate(page, page.getByLabel("Requested Delivery Date"), "2026-04-15");

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

  test("expanded order lines show physical stock instead of projected shortage", async ({
    page,
    db,
  }) => {
    const materialName = `Fast Oversold Stock Label ${ts}`;
    const materialSku = `FAST-OVERSOLD-STOCK-${ts}`;
    const materialResult = await createItem({
      name: materialName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: materialSku,
      category: `Fast Sales ${ts}`,
      description: "Material for expanded order stock label regression",
      defaultPurchasePrice: "1",
      defaultSellingPrice: "10",
      stock: "150",
      safetyStock: "0",
    });
    expect(materialResult.status).toBe(201);
    const materialId = materialResult.body.id as string;

    const orderResult = await createSalesOrder({
      customerId,
      status: "confirmed",
      confirmOversell: true,
      lines: [{ itemId: materialId, quantity: "350", unitPrice: "10" }],
    });
    expect(orderResult.status).toBe(201);
    const oversoldOrderId = orderResult.body.id as string;

    const [order] = await db
      .select({ orderNumber: salesOrders.orderNumber })
      .from(salesOrders)
      .where(eq(salesOrders.id, oversoldOrderId));

    await page.goto("/sales/orders");
    await filterList(page, "Search orders", order.orderNumber);

    const orderRow = page.getByRole("row", { name: new RegExp(order.orderNumber) });
    await orderRow.getByRole("button", { name: "Expand order" }).click();

    const expandedLine = page.getByRole("row", {
      name: new RegExp(`${materialName}.*${materialSku}`),
    }).last();
    await expect(expandedLine).toContainText("150");
    await expect(expandedLine).not.toContainText("-200");
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

  test("keeps Create MOs enabled on the orders list when another line is already in production", async ({
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

    const linkedMoResult = await testFetch(
      `/api/sales-orders/${partialMoOrderId}/manufacturing-orders`,
      {
        method: "POST",
        body: JSON.stringify({ plannedDate: null, notes: null }),
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
    await expect(orderRow.getByRole("button", { name: "In production" })).toBeVisible();
    await expect(orderRow.getByRole("link", { name: "Create MOs" })).toBeVisible();
  });
});
