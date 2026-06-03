import { eq, inArray, sql } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  inventoryDemandSummary,
  inventoryItemBalances,
  inventoryLocations,
  salesOrderLines,
  salesOrders,
} from "../../../lib/db/schema";
import {
  createCustomer,
  createItem,
  createManufacturingOrder,
  createSalesOrder,
  getOrgId,
  getUnitId,
  testFetch,
} from "../../helpers/api";
import { computeDemandQueueCoverage } from "../../../lib/inventory/allocation/coverage-engine";
import {
  consumeStockFifoInTx,
  createPositiveStockEventInTx,
} from "../../../lib/inventory/kernel";

test("demand queue allocates scarce stock by rank without overclaiming", async ({
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
    lines: Array<{
      demandQueueInStockQty?: string;
      demandQueueShortQty?: string;
    }>;
    fulfillmentSummary?: { salesItemsState?: string };
  }>;
  const firstReadModel = salesOrderRows.find((order) => order.id === firstOrder!.id);
  const secondReadModel = salesOrderRows.find((order) => order.id === secondOrder!.id);
  expect(firstReadModel?.fulfillmentSummary?.salesItemsState).toBe("available");
  expect(secondReadModel?.fulfillmentSummary?.salesItemsState).toBe("not_available");
  expect(Number(firstReadModel?.lines[0]?.demandQueueInStockQty ?? 0)).toBe(8);
  expect(Number(firstReadModel?.lines[0]?.demandQueueShortQty ?? 0)).toBe(0);
  expect(Number(secondReadModel?.lines[0]?.demandQueueInStockQty ?? 0)).toBe(2);
  expect(Number(secondReadModel?.lines[0]?.demandQueueShortQty ?? 0)).toBe(6);

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

test("demand queue treats constraint-delayed on-hand supply as expected", () => {
  const [coverage] = computeDemandQueueCoverage({
    today: "2026-06-02",
    supply: [
      {
        kind: "on_hand",
        sourceType: "inventory_lot",
        sourceId: "mature-lot",
        quantity: 6,
        availableDate: "2026-05-29",
        label: "Mature lot",
      },
      {
        kind: "on_hand",
        sourceType: "inventory_lot",
        sourceId: "future-mature-lot",
        quantity: 4,
        availableDate: "2026-06-02",
        label: "Future mature lot",
      },
    ],
    demands: [
      {
        demandType: "manufacturing_order_ingredient",
        demandId: "ingredient-1",
        itemId: "item-1",
        itemName: "Aged component",
        unitName: "Each",
        label: "MO-1",
        contextLabel: "Finished good",
        requiredDate: "2026-06-06T00:00:00.000Z",
        href: null,
        openQty: 10,
        priorityRank: 1,
        priorityDate: "2026-06-06",
        priorityLabel: "MO-1",
        minimumLotAgeDays: 3,
      },
    ],
  });

  expect(coverage.inStockQty).toBe(6);
  expect(coverage.expectedQty).toBe(4);
  expect(coverage.shortQty).toBe(0);
  expect(coverage.latestExpectedDate).toBe("2026-06-05");
  expect(coverage.segments).toMatchObject([
    { kind: "in_stock", qty: 6, sourceId: "mature-lot" },
    {
      kind: "expected",
      qty: 4,
      availableDate: "2026-06-05",
      sourceId: "future-mature-lot",
    },
  ]);
});

test("sales availability treats linked manufacturing output as expected supply", async ({
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
    .select({
      id: salesOrderLines.id,
      itemName: salesOrderLines.itemName,
      itemSku: salesOrderLines.itemSku,
      unitName: salesOrderLines.unitName,
    })
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

test("untracked on-hand coverage uses physical canonical lot quantity", async () => {
  const ts = Date.now();
  const unitId = getUnitId();

  const component = await createItem({
    itemType: "material",
    name: `Fast Untracked Pin Component ${ts}`,
    unitDefinitionId: unitId,
    sku: `FAST-UNTRACKED-PIN-COMP-${ts}`,
    category: `Fast Planning ${ts}`,
    description: null,
    defaultPurchasePrice: "4.00",
    defaultSellingPrice: null,
    stock: "100",
    safetyStock: "0",
    bom: [],
  });
  expect(component.status).toBe(201);

  const product = await createItem({
    itemType: "product",
    name: `Fast Untracked Pinned Product ${ts}`,
    sellable: true,
    unitDefinitionId: unitId,
    sku: `FAST-UNTRACKED-PIN-${ts}`,
    category: `Fast Planning ${ts}`,
    description: null,
    defaultPurchasePrice: null,
    defaultSellingPrice: "10.00",
    stock: "12",
    safetyStock: "0",
    bom: [{ componentId: component.body.id, quantity: "1" }],
  });
  expect(product.status).toBe(201);
  const productId = product.body.id as string;

  const modeResponse = await testFetch(`/api/item-cards/${productId}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: `Fast Untracked Pinned Product ${ts}`,
      category: `Fast Planning ${ts}`,
      description: null,
      unitDefinitionId: unitId,
      lotTrackingMode: "untracked",
    }),
  });
  expect(modeResponse.status).toBe(200);

  const customer = await createCustomer({ name: `Fast Untracked Pin Customer ${ts}` });
  expect(customer.status).toBe(201);

  const order = await createSalesOrder({
    customerId: customer.body.id,
    orderNumber: `UNTRACKED-PIN-${ts}`,
    orderDate: "2026-05-25",
    shipDate: "2026-06-05",
    lines: [{ itemId: productId, quantity: "5", unitPrice: "10.00" }],
  });
  expect(order.status).toBe(201);

  const salesOrdersResponse = await testFetch("/api/sales-orders");
  expect(salesOrdersResponse.status).toBe(200);
  const salesOrderRows = (await salesOrdersResponse.json()) as Array<{
    id: string;
    lines: Array<{
      demandQueueInStockQty?: string;
      demandQueueShortQty?: string;
    }>;
  }>;
  const readModel = salesOrderRows.find((row) => row.id === order.body.id);

  expect(readModel?.lines[0]).toMatchObject({
    demandQueueInStockQty: "5",
    demandQueueShortQty: "0",
  });
});

test("demand queue nets negative lot debt before exposing positive lots", async ({
  db,
}) => {
  const ts = Date.now();
  const orgId = getOrgId();
  const unitId = getUnitId();

  const component = await createItem({
    itemType: "material",
    name: `Fast Negative Lot Debt Component ${ts}`,
    unitDefinitionId: unitId,
    sku: `FAST-NEG-LOT-DEBT-COMP-${ts}`,
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
    name: `Fast Negative Lot Debt Product ${ts}`,
    sellable: true,
    unitDefinitionId: unitId,
    sku: `FAST-NEG-LOT-DEBT-${ts}`,
    category: `Fast Planning ${ts}`,
    description: null,
    defaultPurchasePrice: "2.00",
    defaultSellingPrice: "10.00",
    stock: "0",
    safetyStock: "0",
    bom: [{ componentId: component.body.id, quantity: "1" }],
  });
  expect(product.status).toBe(201);
  const productId = product.body.id as string;

  const modeResponse = await testFetch(`/api/item-cards/${productId}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: `Fast Negative Lot Debt Product ${ts}`,
      category: `Fast Planning ${ts}`,
      description: null,
      unitDefinitionId: unitId,
      lotTrackingMode: "tracked",
    }),
  });
  expect(modeResponse.status).toBe(200);

  const [location] = await db
    .select({ id: inventoryLocations.id })
    .from(inventoryLocations)
    .where(sql`${inventoryLocations.organizationId} = ${orgId} AND ${inventoryLocations.isDefault} = true`);
  if (!location?.id) throw new Error("Default inventory location not found.");

  await db.transaction(async (tx) => {
    await consumeStockFifoInTx(tx, {
      organizationId: orgId,
      locationId: location.id,
      itemId: productId,
      quantity: 10,
      eventType: "manual_adjustment_decrease",
      eventSubtype: "fast_demand_queue_negative_debt",
      referenceType: "item",
      referenceId: productId,
      allowNegativeStock: true,
    });
    await createPositiveStockEventInTx(tx, {
      organizationId: orgId,
      locationId: location.id,
      itemId: productId,
      quantity: 7,
      unitCost: "2.00",
      eventType: "manual_adjustment_increase",
      eventSubtype: "fast_demand_queue_negative_debt",
      referenceType: "item",
      referenceId: productId,
      lotNumber: `LOT-POS-${ts}`,
    });
  });

  const [balance] = await db
    .select({ onHandQty: inventoryItemBalances.onHandQty })
    .from(inventoryItemBalances)
    .where(eq(inventoryItemBalances.itemId, productId));
  expect(Number(balance.onHandQty)).toBeLessThan(0);

  const customer = await createCustomer({
    name: `Fast Negative Lot Debt Customer ${ts}`,
  });
  expect(customer.status).toBe(201);

  const order = await createSalesOrder({
    customerId: customer.body.id,
    orderNumber: `NEG-LOT-DEBT-${ts}`,
    orderDate: "2026-05-25",
    shipDate: "2026-06-05",
    lines: [{ itemId: productId, quantity: "1", unitPrice: "10.00" }],
  });
  expect(order.status).toBe(201);

  const salesOrdersResponse = await testFetch("/api/sales-orders");
  expect(salesOrdersResponse.status).toBe(200);
  const salesOrderRows = (await salesOrdersResponse.json()) as Array<{
    id: string;
    lines: Array<{
      demandQueueInStockQty?: string;
      demandQueueShortQty?: string;
    }>;
    fulfillmentSummary?: { salesItemsState?: string };
  }>;
  const readModel = salesOrderRows.find((row) => row.id === order.body.id);

  expect(readModel?.fulfillmentSummary?.salesItemsState).toBe("not_available");
  expect(readModel?.lines[0]).toMatchObject({
    demandQueueInStockQty: "0",
    demandQueueShortQty: "1",
  });
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

test("linked make-to-order output is constrained without jumping queue stock", async ({
  db,
}) => {
  const ts = Date.now();
  const unitId = getUnitId();

  const component = await createItem({
    itemType: "material",
    name: `Fast MTO Pin Component ${ts}`,
    unitDefinitionId: unitId,
    sku: `FAST-MTO-PIN-COMP-${ts}`,
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
    name: `Fast MTO Pin Product ${ts}`,
    sellable: true,
    unitDefinitionId: unitId,
    sku: `FAST-MTO-PIN-${ts}`,
    category: `Fast Planning ${ts}`,
    description: null,
    defaultPurchasePrice: null,
    defaultSellingPrice: "10.00",
    stock: "8",
    safetyStock: "0",
    bom: [{ componentId: component.body.id, quantity: "1" }],
  });
  expect(product.status).toBe(201);
  const productId = product.body.id as string;

  const customer = await createCustomer({ name: `Fast MTO Pin Customer ${ts}` });
  expect(customer.status).toBe(201);

  const linkedOrder = await createSalesOrder({
    customerId: customer.body.id,
    orderNumber: `MTO-PIN-A-${ts}`,
    orderDate: "2026-05-10",
    shipDate: "2026-05-20",
    lines: [{ itemId: productId, quantity: "8", unitPrice: "10.00" }],
  });
  expect(linkedOrder.status).toBe(201);

  const queueOrder = await createSalesOrder({
    customerId: customer.body.id,
    orderNumber: `MTO-PIN-B-${ts}`,
    orderDate: "2026-05-11",
    shipDate: "2026-05-21",
    lines: [{ itemId: productId, quantity: "8", unitPrice: "10.00" }],
  });
  expect(queueOrder.status).toBe(201);

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
    plannedDate: "2026-05-19",
    ingredients: [{ itemId: component.body.id, quantityPerUnit: "1" }],
    confirmShortage: false,
  });
  expect(linkedMo.status).toBe(201);

  const salesOrdersResponse = await testFetch("/api/sales-orders");
  expect(salesOrdersResponse.status).toBe(200);
  const salesOrderRows = (await salesOrdersResponse.json()) as Array<{
    id: string;
    fulfillmentSummary?: {
      salesItemsState?: string;
      salesItemsExpectedDate?: string | null;
    };
    lines?: Array<{
      demandQueueQueueCoveredQty?: string;
      demandQueueInStockQty?: string;
      demandQueueExpectedQty?: string;
      demandQueueSegments?: Array<{ kind: string; qty: string }>;
    }>;
  }>;
  const linkedReadModel = salesOrderRows.find(
    (row) => row.id === linkedOrder.body.id
  );
  const queueReadModel = salesOrderRows.find((row) => row.id === queueOrder.body.id);
  const linkedQueueLine = linkedReadModel?.lines?.[0];
  const queueLine = queueReadModel?.lines?.[0];

  expect(linkedReadModel?.fulfillmentSummary?.salesItemsState).toBe("available");
  expect(linkedReadModel?.fulfillmentSummary?.salesItemsExpectedDate).toBeNull();
  expect(Number(linkedQueueLine?.demandQueueQueueCoveredQty ?? 0)).toBe(8);
  expect(Number(linkedQueueLine?.demandQueueInStockQty ?? 0)).toBe(8);
  expect(Number(linkedQueueLine?.demandQueueExpectedQty ?? 0)).toBe(0);
  expect(
    linkedQueueLine?.demandQueueSegments?.some(
      (segment) => segment.kind.startsWith("pinned")
    )
  ).toBe(false);

  expect(queueReadModel?.fulfillmentSummary?.salesItemsState).toBe("not_available");
  expect(Number(queueLine?.demandQueueQueueCoveredQty ?? 0)).toBe(0);
  expect(Number(queueLine?.demandQueueInStockQty ?? 0)).toBe(0);
  expect(Number(queueLine?.demandQueueExpectedQty ?? 0)).toBe(0);
  expect(
    queueLine?.demandQueueSegments?.some((segment) =>
      segment.kind.startsWith("pinned")
    )
  ).toBe(false);
});

test("make-to-order preview ignores queue stock and avoids double-counting linked output and shipped quantity", async ({
  db,
}) => {
  const ts = Date.now();
  const unitId = getUnitId();

  const component = await createItem({
    itemType: "material",
    name: `Fast MTO Qty Component ${ts}`,
    unitDefinitionId: unitId,
    sku: `FAST-MTO-QTY-COMP-${ts}`,
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
    name: `Fast MTO Qty Product ${ts}`,
    sellable: true,
    unitDefinitionId: unitId,
    sku: `FAST-MTO-QTY-${ts}`,
    category: `Fast Planning ${ts}`,
    description: null,
    defaultPurchasePrice: null,
    defaultSellingPrice: "10.00",
    stock: "8",
    safetyStock: "0",
    bom: [{ componentId: component.body.id, quantity: "1" }],
  });
  expect(product.status).toBe(201);
  const productId = product.body.id as string;

  const customer = await createCustomer({ name: `Fast MTO Qty Customer ${ts}` });
  expect(customer.status).toBe(201);

  const order = await createSalesOrder({
    customerId: customer.body.id,
    orderNumber: `MTO-QTY-${ts}`,
    orderDate: "2026-05-10",
    shipDate: "2026-05-20",
    lines: [{ itemId: productId, quantity: "8", unitPrice: "10.00" }],
  });
  expect(order.status).toBe(201);

  const previewBeforeMoResponse = await testFetch(
    `/api/sales-orders/${order.body.id}/manufacturing-orders`
  );
  expect(previewBeforeMoResponse.status).toBe(200);
  const previewBeforeMo = (await previewBeforeMoResponse.json()) as {
    lines: Array<{ status: string; quantity: string }>;
  };
  expect(previewBeforeMo.lines[0]).toMatchObject({
    status: "will_create",
    quantity: "8",
  });

  const [line] = await db
    .select({
      id: salesOrderLines.id,
      itemName: salesOrderLines.itemName,
      itemSku: salesOrderLines.itemSku,
      unitName: salesOrderLines.unitName,
    })
    .from(salesOrderLines)
    .where(eq(salesOrderLines.salesOrderId, order.body.id));
  expect(line).toBeTruthy();

  const linkedMo = await createManufacturingOrder({
    productId,
    salesOrderId: order.body.id,
    salesOrderLineId: line.id,
    plannedQuantity: "3",
    plannedDate: "2026-05-19",
    ingredients: [{ itemId: component.body.id, quantityPerUnit: "1" }],
    confirmShortage: false,
  });
  expect(linkedMo.status).toBe(201);

  const previewAfterMoResponse = await testFetch(
    `/api/sales-orders/${order.body.id}/manufacturing-orders`
  );
  expect(previewAfterMoResponse.status).toBe(200);
  const previewAfterMo = (await previewAfterMoResponse.json()) as {
    lines: Array<{ status: string; quantity: string }>;
  };
  expect(previewAfterMo.lines[0]).toMatchObject({
    status: "will_create",
    quantity: "5",
  });

  await db
    .update(salesOrderLines)
    .set({ shippedQuantity: "2" })
    .where(eq(salesOrderLines.id, line.id));

  const previewAfterShippingResponse = await testFetch(
    `/api/sales-orders/${order.body.id}/manufacturing-orders`
  );
  expect(previewAfterShippingResponse.status).toBe(200);
  const previewAfterShipping = (await previewAfterShippingResponse.json()) as {
    lines: Array<{ status: string; quantity: string }>;
  };
  expect(previewAfterShipping.lines[0]).toMatchObject({
    status: "will_create",
    quantity: "5",
  });

  const cancelledOrder = await createSalesOrder({
    customerId: customer.body.id,
    orderNumber: `MTO-CANCELLED-${ts}`,
    orderDate: "2026-05-10",
    shipDate: "2026-05-20",
    lines: [{ itemId: productId, quantity: "8", unitPrice: "10.00" }],
  });
  expect(cancelledOrder.status).toBe(201);
  const [cancelledLine] = await db
    .select({ id: salesOrderLines.id })
    .from(salesOrderLines)
    .where(eq(salesOrderLines.salesOrderId, cancelledOrder.body.id));
  expect(cancelledLine).toBeTruthy();
  await db
    .update(salesOrderLines)
    .set({ cancelledQuantity: "8" })
    .where(eq(salesOrderLines.id, cancelledLine.id));

  const cancelledPreviewResponse = await testFetch(
    `/api/sales-orders/${cancelledOrder.body.id}/manufacturing-orders`
  );
  expect(cancelledPreviewResponse.status).toBe(200);
  const cancelledPreview = (await cancelledPreviewResponse.json()) as {
    lines: Array<{ status: string; skipReason: string | null }>;
  };
  expect(cancelledPreview.lines[0]).toMatchObject({
    status: "skipped",
    skipReason: "no_remaining_demand",
  });
});
