import { eq, inArray, sql } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  inventoryDemandSummary,
  inventoryItemBalances,
  salesOrders,
} from "../../../lib/db/schema";
import {
  createCustomer,
  createItem,
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

  const reorder = await testFetch("/api/sales-orders/priority-ranks", {
    method: "PATCH",
    body: JSON.stringify({ orderIds: [first.body.id, second.body.id] }),
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
    .where(inArray(salesOrders.id, [first.body.id, second.body.id]));
  const rankById = new Map(rankedOrders.map((row) => [row.id, row.priorityRank]));
  const firstRank = rankById.get(first.body.id);
  const secondRank = rankById.get(second.body.id);
  expect(firstRank).toBeTruthy();
  expect(secondRank).toBeTruthy();
  expect(firstRank!).toBeLessThan(secondRank!);

  const salesOrdersResponse = await testFetch("/api/sales-orders");
  expect(salesOrdersResponse.status).toBe(200);
  const salesOrderRows = (await salesOrdersResponse.json()) as Array<{
    id: string;
    fulfillmentSummary?: { salesItemsState?: string };
  }>;
  const firstReadModel = salesOrderRows.find((order) => order.id === first.body.id);
  const secondReadModel = salesOrderRows.find((order) => order.id === second.body.id);
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
