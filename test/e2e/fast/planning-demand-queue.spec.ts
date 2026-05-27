import { eq, inArray, sql } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  inventoryDemandSummary,
  inventoryItemBalances,
  manufacturingOrders,
  salesOrderLines,
  salesOrders,
  stockAllocations,
} from "../../../lib/db/schema";
import {
  createCustomer,
  createItem,
  createManufacturingOrder,
  createSalesOrder,
  getUnitId,
  testFetch,
} from "../../helpers/api";

test("demand queue allocates scarce stock by rank without overclaiming", async ({
  page,
  db,
}) => {
  const ts = Date.now();
  const unitId = getUnitId();

  const component = await createItem({
    itemType: "material",
    name: `Fast Demand Queue Component ${ts}`,
    unitDefinitionId: unitId,
    sku: `FAST-DEMAND-QUEUE-COMP-${ts}`,
    category: `Fast Planning ${ts}`,
    description: null,
    defaultPurchasePrice: "2.00",
    defaultSellingPrice: null,
    stock: "100",
    safetyStock: "0",
    bom: [],
  });
  expect(component.status).toBe(201);

  const product = await createItem({
    itemType: "product",
    name: `Fast Demand Queue Product ${ts}`,
    sellable: true,
    unitDefinitionId: unitId,
    sku: `FAST-DEMAND-QUEUE-${ts}`,
    category: `Fast Planning ${ts}`,
    description: null,
    defaultPurchasePrice: null,
    defaultSellingPrice: "10.00",
    stock: "10",
    safetyStock: "0",
    bom: [{ componentId: component.body.id, quantity: "1" }],
  });
  expect(product.status).toBe(201);
  const productId = product.body.id as string;

  const customer = await createCustomer({ name: `Fast Demand Queue Customer ${ts}` });
  expect(customer.status).toBe(201);

  const firstOrderNumber = `DQ-A-${ts}`;
  const secondOrderNumber = `DQ-B-${ts}`;
  const first = await createSalesOrder({
    customerId: customer.body.id,
    orderNumber: firstOrderNumber,
    orderDate: "2026-05-10",
    shipDate: "2026-05-20",
    lines: [{ itemId: productId, quantity: "8", unitPrice: "10.00" }],
  });
  const second = await createSalesOrder({
    customerId: customer.body.id,
    orderNumber: secondOrderNumber,
    orderDate: "2026-05-11",
    shipDate: "2026-05-12",
    lines: [{ itemId: productId, quantity: "8", unitPrice: "10.00" }],
  });
  expect(first.status).toBe(201);
  expect(second.status).toBe(201);

  const createdOrders = await db
    .select({
      id: salesOrders.id,
      orderNumber: salesOrders.orderNumber,
      priorityRank: salesOrders.priorityRank,
    })
    .from(salesOrders)
    .where(inArray(salesOrders.orderNumber, [firstOrderNumber, secondOrderNumber]));
  const createdByOrderNumber = new Map(
    createdOrders.map((row) => [row.orderNumber, row])
  );
  const firstOrder = createdByOrderNumber.get(firstOrderNumber);
  const secondOrder = createdByOrderNumber.get(secondOrderNumber);
  expect(firstOrder).toBeTruthy();
  expect(secondOrder).toBeTruthy();

  const reorder = await testFetch("/api/sales-orders/priority-ranks", {
    method: "PATCH",
    body: JSON.stringify({ orderIds: [firstOrder!.id, secondOrder!.id] }),
  });
  expect(reorder.status).toBe(200);

  await page.goto("/sales/orders");
  await expect(page.locator("main")).toContainText(firstOrderNumber);

  const rankedOrders = await db
    .select({
      id: salesOrders.id,
      priorityRank: salesOrders.priorityRank,
    })
    .from(salesOrders)
    .where(inArray(salesOrders.id, [firstOrder!.id, secondOrder!.id]));
  const rankById = new Map(rankedOrders.map((row) => [row.id, row.priorityRank]));
  const firstRank = rankById.get(firstOrder!.id);
  const secondRank = rankById.get(secondOrder!.id);
  expect(firstRank).toBeTruthy();
  expect(secondRank).toBeTruthy();
  expect(firstRank!).toBeLessThan(secondRank!);

  const salesOrdersResponse = await testFetch("/api/sales-orders");
  expect(salesOrdersResponse.status).toBe(200);
  const salesOrderRows = (await salesOrdersResponse.json()) as Array<{
    id: string;
    fulfillmentSummary?: { salesItemsState?: string };
  }>;
  const firstReadModel = salesOrderRows.find((order) => order.id === firstOrder!.id);
  const secondReadModel = salesOrderRows.find((order) => order.id === secondOrder!.id);
  expect(firstReadModel?.fulfillmentSummary?.salesItemsState).toBe("available");
  expect(secondReadModel?.fulfillmentSummary?.salesItemsState).toBe("not_available");

  const [demand] = await db
    .select({ total: sql<string>`COALESCE(SUM(${inventoryDemandSummary.quantity}), 0)` })
    .from(inventoryDemandSummary)
    .where(eq(inventoryDemandSummary.itemId, productId));
  expect(Number(demand.total)).toBe(16);

  const [balance] = await db
    .select({
      onHandQty: inventoryItemBalances.onHandQty,
      demandQty: inventoryItemBalances.demandQty,
      shortageQty: inventoryItemBalances.shortageQty,
      availableToPromise: inventoryItemBalances.availableToPromise,
    })
    .from(inventoryItemBalances)
    .where(eq(inventoryItemBalances.itemId, productId));

  expect(balance).toMatchObject({
    onHandQty: "10.0000",
    demandQty: "16.0000",
    shortageQty: "6.0000",
    availableToPromise: "-6.0000",
  });
});

test("sales availability treats pinned manufacturing output as expected supply", async ({
  db,
}) => {
  const ts = Date.now();
  const unitId = getUnitId();

  const component = await createItem({
    itemType: "material",
    name: `Fast Pinned MO Component ${ts}`,
    unitDefinitionId: unitId,
    sku: `FAST-PINNED-MO-COMP-${ts}`,
    category: `Fast Planning ${ts}`,
    description: null,
    defaultPurchasePrice: "2.00",
    defaultSellingPrice: null,
    stock: "1000",
    safetyStock: "0",
    bom: [],
  });
  expect(component.status).toBe(201);

  const product = await createItem({
    itemType: "product",
    name: `Fast Pinned MO Product ${ts}`,
    sellable: true,
    unitDefinitionId: unitId,
    sku: `FAST-PINNED-MO-${ts}`,
    category: `Fast Planning ${ts}`,
    description: null,
    defaultPurchasePrice: null,
    defaultSellingPrice: "10.00",
    stock: "0",
    safetyStock: "0",
    bom: [{ componentId: component.body.id, quantity: "1" }],
  });
  expect(product.status).toBe(201);
  const productId = product.body.id as string;

  const customer = await createCustomer({ name: `Fast Pinned MO Customer ${ts}` });
  expect(customer.status).toBe(201);

  const order = await createSalesOrder({
    customerId: customer.body.id,
    orderNumber: `PINNED-MO-${ts}`,
    orderDate: "2026-05-25",
    shipDate: "2026-06-05",
    lines: [{ itemId: productId, quantity: "450", unitPrice: "10.00" }],
  });
  expect(order.status).toBe(201);

  const [line] = await db
    .select({ id: salesOrderLines.id })
    .from(salesOrderLines)
    .where(eq(salesOrderLines.salesOrderId, order.body.id));
  expect(line).toBeTruthy();

  const linkedMo = await createManufacturingOrder({
    productId,
    salesOrderId: order.body.id,
    salesOrderLineId: line.id,
    plannedQuantity: "150",
    plannedDate: "2026-06-02",
    ingredients: [{ itemId: component.body.id, quantityPerUnit: "1" }],
    confirmShortage: false,
  });
  expect(linkedMo.status).toBe(201);

  const laterMo = await createManufacturingOrder({
    productId,
    plannedQuantity: "300",
    plannedDate: "2026-06-04",
    ingredients: [{ itemId: component.body.id, quantityPerUnit: "1" }],
    confirmShortage: false,
  });
  expect(laterMo.status).toBe(201);

  const [source] = await db
    .select({ organizationId: manufacturingOrders.organizationId })
    .from(manufacturingOrders)
    .where(eq(manufacturingOrders.id, linkedMo.body.id));
  expect(source).toBeTruthy();

  await db.insert(stockAllocations).values([
    {
      organizationId: source.organizationId,
      demandType: "sales_order_line",
      demandId: line.id,
      itemId: productId,
      sourceType: "manufacturing_order",
      sourceId: linkedMo.body.id,
      quantity: "150",
      status: "active",
    },
    {
      organizationId: source.organizationId,
      demandType: "sales_order_line",
      demandId: line.id,
      itemId: productId,
      sourceType: "manufacturing_order",
      sourceId: laterMo.body.id,
      quantity: "300",
      status: "active",
    },
  ]);

  const salesOrdersResponse = await testFetch("/api/sales-orders");
  expect(salesOrdersResponse.status).toBe(200);
  const salesOrderRows = (await salesOrdersResponse.json()) as Array<{
    id: string;
    fulfillmentSummary?: {
      salesItemsState?: string;
      salesItemsExpectedDate?: string | null;
    };
  }>;
  const readModel = salesOrderRows.find((row) => row.id === order.body.id);

  expect(readModel?.fulfillmentSummary?.salesItemsState).toBe("expected");
  expect(readModel?.fulfillmentSummary?.salesItemsExpectedDate).toBe("2026-06-04");
});

test("linked manufacturing output does not cover unrelated sales demand", async ({
  db,
}) => {
  const ts = Date.now();
  const unitId = getUnitId();

  const component = await createItem({
    itemType: "material",
    name: `Fast Linked MO Component ${ts}`,
    unitDefinitionId: unitId,
    sku: `FAST-LINKED-MO-COMP-${ts}`,
    category: `Fast Planning ${ts}`,
    description: null,
    defaultPurchasePrice: "2.00",
    defaultSellingPrice: null,
    stock: "1000",
    safetyStock: "0",
    bom: [],
  });
  expect(component.status).toBe(201);

  const product = await createItem({
    itemType: "product",
    name: `Fast Linked MO Product ${ts}`,
    sellable: true,
    unitDefinitionId: unitId,
    sku: `FAST-LINKED-MO-${ts}`,
    category: `Fast Planning ${ts}`,
    description: null,
    defaultPurchasePrice: null,
    defaultSellingPrice: "10.00",
    stock: "0",
    safetyStock: "0",
    bom: [{ componentId: component.body.id, quantity: "1" }],
  });
  expect(product.status).toBe(201);
  const productId = product.body.id as string;

  const customer = await createCustomer({ name: `Fast Linked MO Customer ${ts}` });
  expect(customer.status).toBe(201);

  const linkedOrder = await createSalesOrder({
    customerId: customer.body.id,
    orderNumber: `LINKED-MO-A-${ts}`,
    orderDate: "2026-05-10",
    shipDate: "2026-05-20",
    lines: [{ itemId: productId, quantity: "8", unitPrice: "10.00" }],
  });
  expect(linkedOrder.status).toBe(201);

  const unrelatedOrder = await createSalesOrder({
    customerId: customer.body.id,
    orderNumber: `LINKED-MO-B-${ts}`,
    orderDate: "2026-05-11",
    shipDate: "2026-05-12",
    lines: [{ itemId: productId, quantity: "8", unitPrice: "10.00" }],
  });
  expect(unrelatedOrder.status).toBe(201);

  const [linkedLine] = await db
    .select({ id: salesOrderLines.id })
    .from(salesOrderLines)
    .where(eq(salesOrderLines.salesOrderId, linkedOrder.body.id));
  expect(linkedLine).toBeTruthy();

  const linkedMo = await createManufacturingOrder({
    productId,
    salesOrderId: linkedOrder.body.id,
    salesOrderLineId: linkedLine.id,
    plannedQuantity: "8",
    plannedDate: "2026-05-11",
    ingredients: [{ itemId: component.body.id, quantityPerUnit: "1" }],
    confirmShortage: false,
  });
  expect(linkedMo.status).toBe(201);

  const reorder = await testFetch("/api/sales-orders/priority-ranks", {
    method: "PATCH",
    body: JSON.stringify({
      orderIds: [unrelatedOrder.body.id, linkedOrder.body.id],
    }),
  });
  expect(reorder.status).toBe(200);

  const salesOrdersResponse = await testFetch("/api/sales-orders");
  expect(salesOrdersResponse.status).toBe(200);
  const salesOrderRows = (await salesOrdersResponse.json()) as Array<{
    id: string;
    fulfillmentSummary?: {
      salesItemsState?: string;
      productionState?: string;
      shortQty?: string;
    };
  }>;
  const linkedReadModel = salesOrderRows.find(
    (row) => row.id === linkedOrder.body.id
  );
  const unrelatedReadModel = salesOrderRows.find(
    (row) => row.id === unrelatedOrder.body.id
  );

  expect(linkedReadModel?.fulfillmentSummary?.salesItemsState).toBe("expected");
  expect(unrelatedReadModel?.fulfillmentSummary?.salesItemsState).toBe(
    "not_available"
  );
  expect(unrelatedReadModel?.fulfillmentSummary?.shortQty).toBe("8");
  expect(unrelatedReadModel?.fulfillmentSummary?.productionState).toBe("make");
});
