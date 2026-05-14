import { and, asc, eq, sql } from "drizzle-orm";
import type { Page } from "@playwright/test";
import { test, expect, filterList } from "../fixtures";
import {
  inventoryDemandSummary,
  inventoryItemBalances,
  inventoryReservationsSummary,
  lots,
  manufacturingOrders,
  stockAllocations,
  salesOrderLines,
  salesOrders,
} from "../../../lib/db/schema";
import {
  createCustomer,
  completeManufacturingOrder,
  createItem,
  createManufacturingOrder,
  createSalesOrder,
  getUnitId,
  releaseManufacturingOrder,
  testFetch,
} from "../../helpers/api";
import type { TestDb } from "../fixtures";

function unique(prefix: string) {
  return `${prefix} ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`;
}

function sku(prefix: string) {
  return unique(prefix).toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 48);
}

function salesOrderCard(page: Page, orderNumber: string) {
  return page.getByRole("row").filter({ hasText: orderNumber }).first();
}

async function expandSalesOrderCard(page: Page, orderNumber: string) {
  const row = salesOrderCard(page, orderNumber);
  await row
    .getByRole("button", { name: new RegExp(`Expand.*${orderNumber}|Expand order`) })
    .click();
  return row;
}

async function createCustomerFixture(namePrefix: string) {
  const result = await createCustomer({ name: unique(namePrefix) });
  expect(result.status).toBe(201);
  return result.body.id as string;
}

async function createMaterialFixture(params: {
  namePrefix: string;
  stock: string;
  sellingPrice?: string | null;
}) {
  const name = unique(params.namePrefix);
  const result = await createItem({
    name,
    itemType: "material",
    unitDefinitionId: getUnitId(),
    sku: sku(params.namePrefix),
    category: "Slow allocation manager",
    description: null,
    defaultPurchasePrice: "1",
    defaultSellingPrice: params.sellingPrice ?? "10",
    stock: params.stock,
    safetyStock: "0",
    bom: [],
  });
  expect(result.status).toBe(201);
  return { id: result.body.id as string, name };
}

async function createProductFixture(params: {
  productPrefix: string;
  componentPrefix: string;
  stock: string;
  componentStock: string;
}) {
  const component = await createMaterialFixture({
    namePrefix: params.componentPrefix,
    stock: params.componentStock,
    sellingPrice: null,
  });
  const productName = unique(params.productPrefix);
  const productResult = await createItem({
    name: productName,
    itemType: "product",
    unitDefinitionId: getUnitId(),
    sku: sku(params.productPrefix),
    category: "Slow allocation manager",
    description: null,
    defaultPurchasePrice: null,
    defaultSellingPrice: "20",
    stock: params.stock,
    safetyStock: "0",
    bom: [{ componentId: component.id, quantity: "1" }],
  });
  expect(productResult.status).toBe(201);
  return {
    productId: productResult.body.id as string,
    productName,
    componentId: component.id,
  };
}

async function createDraftOrder(params: {
  customerId: string;
  itemId: string;
  quantity: string;
  shipDate?: string | null;
}) {
  const result = await createSalesOrder({
    customerId: params.customerId,
    status: "draft",
    shipDate: params.shipDate ?? "2026-05-20",
    lines: [{ itemId: params.itemId, quantity: params.quantity, unitPrice: "10" }],
  });
  expect(result.status).toBe(201);
  return result.body.id as string;
}

async function getOrderNumber(db: TestDb, orderId: string) {
  const [order] = await db
    .select({ orderNumber: salesOrders.orderNumber })
    .from(salesOrders)
    .where(eq(salesOrders.id, orderId));

  expect(order?.orderNumber).toBeTruthy();
  return order.orderNumber;
}

async function getLine(db: TestDb, orderId: string) {
  const [line] = await db
    .select({
      id: salesOrderLines.id,
      allocationManagedAt: salesOrderLines.allocationManagedAt,
    })
    .from(salesOrderLines)
    .where(eq(salesOrderLines.salesOrderId, orderId))
    .orderBy(asc(salesOrderLines.sortOrder));

  expect(line?.id).toBeTruthy();
  return line;
}

async function getActiveAllocations(db: TestDb, salesOrderLineId: string) {
  return db
    .select({
      sourceType: stockAllocations.sourceType,
      sourceId: stockAllocations.sourceId,
      quantity: stockAllocations.quantity,
      status: stockAllocations.status,
    })
    .from(stockAllocations)
    .where(
      and(
        eq(stockAllocations.demandType, "sales_order_line"),
        eq(stockAllocations.demandId, salesOrderLineId)
      )
    )
    .orderBy(asc(stockAllocations.createdAt));
}

async function getFirstLotId(db: TestDb, itemId: string) {
  const [lot] = await db
    .select({ id: lots.id })
    .from(lots)
    .where(eq(lots.itemId, itemId))
    .orderBy(asc(lots.receivedAt), asc(lots.createdAt), asc(lots.lotNumber), asc(lots.id));

  expect(lot?.id).toBeTruthy();
  return lot.id;
}

async function getItemBalance(db: TestDb, itemId: string) {
  const [balance] = await db
    .select({
      onHandQty: inventoryItemBalances.onHandQty,
      committedQty: inventoryItemBalances.committedQty,
      demandQty: inventoryItemBalances.demandQty,
      shortageQty: inventoryItemBalances.shortageQty,
    })
    .from(inventoryItemBalances)
    .where(eq(inventoryItemBalances.itemId, itemId));

  expect(balance).toBeTruthy();
  return balance;
}

async function getReservationTotal(db: TestDb, itemId: string) {
  const [row] = await db
    .select({
      quantity: sql<string>`COALESCE(SUM(${inventoryReservationsSummary.quantity}), 0)`,
    })
    .from(inventoryReservationsSummary)
    .where(eq(inventoryReservationsSummary.itemId, itemId));

  return row?.quantity ?? "0";
}

async function getDemandTotal(db: TestDb, itemId: string) {
  const [row] = await db
    .select({
      quantity: sql<string>`COALESCE(SUM(${inventoryDemandSummary.quantity}), 0)`,
    })
    .from(inventoryDemandSummary)
    .where(eq(inventoryDemandSummary.itemId, itemId));

  return row?.quantity ?? "0";
}

async function confirmOrder(
  orderId: string,
  options?: {
    confirmOversell?: boolean;
    confirmDraftAllocationTakeover?: boolean;
  }
) {
  const response = await testFetch(`/api/sales-orders/${orderId}/confirm`, {
    method: "POST",
    body: JSON.stringify({
      confirmOversell: options?.confirmOversell ?? false,
      confirmDraftAllocationTakeover:
        options?.confirmDraftAllocationTakeover ?? false,
    }),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

async function openAllocationManager(params: {
  page: Page;
  orderNumber: string;
  itemName: string;
}) {
  const { page, orderNumber, itemName } = params;
  const escapedItemName = itemName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  await page.goto("/sales/orders");
  await filterList(page, "Search orders", orderNumber);
  await expandSalesOrderCard(page, orderNumber);

  const expandedLine = page.getByRole("row", { name: new RegExp(escapedItemName) }).last();
  await expect(expandedLine).toBeVisible();
  await expandedLine
    .getByRole("button", {
      name: new RegExp(`^(Allocate|Manage allocation for) ${escapedItemName}$`),
    })
    .click();

  const sheet = page.getByRole("dialog", { name: "Allocation Manager" });
  await expect(sheet).toBeVisible();
  return sheet;
}

async function saveAllocation(page: Page) {
  await expect(page.getByRole("button", { name: "Save allocation" })).toBeEnabled();
  await page.getByRole("button", { name: "Save allocation" }).click();
  await expect(page.getByRole("button", { name: "Saving..." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save allocation" })).toBeDisabled({
    timeout: 30_000,
  });
}

async function pickAllManufacturingIngredients(orderId: string) {
  const executionResponse = await testFetch(`/api/manufacturing-orders/${orderId}/execution`);
  const executionBody = await executionResponse.json().catch(() => null);

  expect(executionResponse.status).toBe(200);

  for (const ingredient of executionBody?.ingredients ?? []) {
    const pickResponse = await testFetch(
      `/api/manufacturing-orders/${orderId}/ingredients/${ingredient.id}/pick`,
      {
        method: "POST",
        body: JSON.stringify({}),
      }
    );
    const pickBody = await pickResponse.json().catch(() => null);

    expect(pickResponse.status).toBe(200);
    expect(pickBody?.id).toBe(ingredient.id);
  }
}

test.describe("Sales allocation manager slow flow", () => {
  test.describe.configure({ mode: "serial" });

  test("moves draft stock promises between order buckets and confirms only allocated stock", async ({
    page,
    db,
  }) => {
    const customerId = await createCustomerFixture("Slow allocation stock customer");
    const item = await createMaterialFixture({
      namePrefix: "Slow allocation stock item",
      stock: "10",
    });
    const currentOrderId = await createDraftOrder({
      customerId,
      itemId: item.id,
      quantity: "6",
      shipDate: "2026-05-20",
    });
    const competingOrderId = await createDraftOrder({
      customerId,
      itemId: item.id,
      quantity: "5",
      shipDate: "2026-05-21",
    });
    const currentOrderNumber = await getOrderNumber(db, currentOrderId);
    const competingOrderNumber = await getOrderNumber(db, competingOrderId);

    const sheet = await openAllocationManager({
      page,
      orderNumber: currentOrderNumber,
      itemName: item.name,
    });
    const currentBucket = sheet.getByTestId("current-allocation-bucket");
    const competingBucket = sheet
      .getByTestId("readonly-allocation-bucket")
      .filter({ hasText: competingOrderNumber });

    await sheet.getByRole("button", { name: /Allocate all from LOT-/ }).click();
    await currentBucket.click();
    await expect(currentBucket).toContainText(/Allocated\s*6/);
    await expect(currentBucket).toContainText(/Short\s*—/);

    await page.keyboard.press("Escape");
    await currentBucket.click();
    await competingBucket.click();
    await expect(sheet.getByTestId("allocation-holding-hud")).toContainText("Holding");
    await expect(sheet.getByTestId("allocation-holding-hud")).toContainText("1");
    await expect(currentBucket.getByTestId("allocation-ghost-slot")).toBeHidden();
    await currentBucket.click();
    await expect(currentBucket).toContainText(/Allocated\s*1/);
    await expect(currentBucket).toContainText(/Short\s*5/);
    await expect(competingBucket).toContainText(/Allocated\s*5/);
    await expect(competingBucket).toContainText(/Short\s*—/);

    await saveAllocation(page);

    const currentLine = await getLine(db, currentOrderId);
    const competingLine = await getLine(db, competingOrderId);
    const lotId = await getFirstLotId(db, item.id);

    await expect
      .poll(async () => {
        const refreshedCurrentLine = await getLine(db, currentOrderId);
        const refreshedCompetingLine = await getLine(db, competingOrderId);
        const currentAllocations = await getActiveAllocations(db, currentLine.id);
        const competingAllocations = await getActiveAllocations(db, competingLine.id);
        return {
          currentManaged: refreshedCurrentLine.allocationManagedAt != null,
          competingManaged: refreshedCompetingLine.allocationManagedAt != null,
          current: currentAllocations
            .filter((row) => row.status === "active")
            .map((row) => `${row.sourceType}:${row.sourceId}:${row.quantity}`),
          competing: competingAllocations
            .filter((row) => row.status === "active")
            .map((row) => `${row.sourceType}:${row.sourceId}:${row.quantity}`),
        };
      })
      .toEqual({
        currentManaged: true,
        competingManaged: true,
        current: [`inventory_lot:${lotId}:1.0000`],
        competing: [`inventory_lot:${lotId}:5.0000`],
      });

    const openBalance = await getItemBalance(db, item.id);
    expect(openBalance.committedQty).toBe("6.0000");
    expect(openBalance.demandQty).toBe("11.0000");
    expect(openBalance.shortageQty).toBe("5.0000");
    expect(await getReservationTotal(db, item.id)).toBe("6.0000");
    expect(await getDemandTotal(db, item.id)).toBe("11.0000");

    expect((await confirmOrder(competingOrderId)).status).toBe(200);
    expect((await confirmOrder(currentOrderId)).status).toBe(200);

    await expect
      .poll(async () => {
        const balance = await getItemBalance(db, item.id);
        return {
          committed: balance.committedQty,
          demand: balance.demandQty,
          shortage: balance.shortageQty,
          reservation: await getReservationTotal(db, item.id),
          demandSummary: await getDemandTotal(db, item.id),
        };
      })
      .toEqual({
        committed: "6.0000",
        demand: "11.0000",
        shortage: "5.0000",
        reservation: "6.0000",
        demandSummary: "11.0000",
      });
  });

  test("production allocation confirms as demand without reserving available stock", async ({
    page,
    db,
  }) => {
    const customerId = await createCustomerFixture("Slow allocation production customer");
    const fixture = await createProductFixture({
      productPrefix: "Slow allocation production product",
      componentPrefix: "Slow allocation production component",
      stock: "20",
      componentStock: "100",
    });
    const manufacturingResult = await createManufacturingOrder({
      productId: fixture.productId,
      plannedQuantity: "8",
      plannedDate: "2026-05-22",
      ingredients: [{ itemId: fixture.componentId, quantityPerUnit: "1" }],
    });
    expect(manufacturingResult.status).toBe(201);
    const manufacturingOrderId = manufacturingResult.body.id as string;
    const [manufacturingOrder] = await db
      .select({ orderNumber: manufacturingOrders.orderNumber })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, manufacturingOrderId));

    const orderId = await createDraftOrder({
      customerId,
      itemId: fixture.productId,
      quantity: "8",
      shipDate: "2026-05-22",
    });
    const orderNumber = await getOrderNumber(db, orderId);

    const sheet = await openAllocationManager({
      page,
      orderNumber,
      itemName: fixture.productName,
    });
    await expect(
      sheet.getByRole("button", {
        name: new RegExp(`Allocate all from ${manufacturingOrder.orderNumber}`),
      })
    ).toBeVisible();
    await sheet
      .getByRole("button", {
        name: new RegExp(`Allocate all from ${manufacturingOrder.orderNumber}`),
      })
      .click();

    const currentBucket = sheet.getByTestId("current-allocation-bucket");
    await currentBucket.click();
    await expect(currentBucket).toContainText(/Allocated\s*8/);
    await expect(currentBucket).toContainText(/Short\s*—/);
    await saveAllocation(page);

    const line = await getLine(db, orderId);
    const allocations = await getActiveAllocations(db, line.id);
    expect(allocations.filter((row) => row.status === "active")).toMatchObject([
      {
        sourceType: "manufacturing_order",
        sourceId: manufacturingOrderId,
        quantity: "8.0000",
      },
    ]);
    const allocationContextBeforeConfirm = await testFetch(
      `/api/sales-order-lines/${line.id}/allocation`
    );
    expect(allocationContextBeforeConfirm.status).toBe(200);
    const allocationContextBody = await allocationContextBeforeConfirm.json();
    expect(allocationContextBody.targetLine.allocatedQty).toBe("8");
    expect(allocationContextBody.targetLine.shortQty).toBe("0");
    expect(allocationContextBody.targetLine.sources).toMatchObject([
      {
        sourceType: "manufacturing_order",
        sourceId: manufacturingOrderId,
        quantity: "8",
      },
    ]);

    const confirmResult = await confirmOrder(orderId);
    expect(confirmResult.status).toBe(200);

    await expect
      .poll(async () => {
        const balance = await getItemBalance(db, fixture.productId);
        return {
          onHand: balance.onHandQty,
          committed: balance.committedQty,
          demand: balance.demandQty,
          shortage: balance.shortageQty,
          reservation: await getReservationTotal(db, fixture.productId),
          demandSummary: await getDemandTotal(db, fixture.productId),
        };
      })
      .toEqual({
        onHand: "20.0000",
        committed: "0.0000",
        demand: "8.0000",
        shortage: "8.0000",
        reservation: "0",
        demandSummary: "8.0000",
      });

    const releaseResult = await releaseManufacturingOrder(manufacturingOrderId);
    expect(releaseResult.status).toBe(200);
    await pickAllManufacturingIngredients(manufacturingOrderId);
    const completeResult = await completeManufacturingOrder(manufacturingOrderId, "8");
    expect(completeResult.status).toBe(200);

    await expect
      .poll(async () => {
        const materializedAllocations = await getActiveAllocations(db, line.id);
        const balance = await getItemBalance(db, fixture.productId);
        return {
          allocationSources: materializedAllocations
            .filter((row) => row.status === "active")
            .map((row) => `${row.sourceType}:${row.quantity}`),
          onHand: balance.onHandQty,
          committed: balance.committedQty,
          demand: balance.demandQty,
          shortage: balance.shortageQty,
          reservation: await getReservationTotal(db, fixture.productId),
          demandSummary: await getDemandTotal(db, fixture.productId),
        };
      })
      .toEqual({
        allocationSources: ["inventory_lot:8.0000"],
        onHand: "28.0000",
        committed: "8.0000",
        demand: "8.0000",
        shortage: "0.0000",
        reservation: "8.0000",
        demandSummary: "8.0000",
      });
  });

  test("confirming open orders leaves existing allocations in place", async ({
    db,
  }) => {
    const customerId = await createCustomerFixture("Slow allocation takeover customer");
    const item = await createMaterialFixture({
      namePrefix: "Slow allocation takeover item",
      stock: "10",
    });
    const draftHeldOrderId = await createDraftOrder({
      customerId,
      itemId: item.id,
      quantity: "8",
      shipDate: "2026-05-23",
    });
    const unmanagedOrderId = await createDraftOrder({
      customerId,
      itemId: item.id,
      quantity: "10",
      shipDate: "2026-05-24",
    });
    const draftHeldLine = await getLine(db, draftHeldOrderId);
    const unmanagedOrderNumber = await getOrderNumber(db, unmanagedOrderId);
    const lotId = await getFirstLotId(db, item.id);

    const allocationResponse = await testFetch(
      `/api/sales-order-lines/${draftHeldLine.id}/allocation`,
      {
        method: "PUT",
        body: JSON.stringify({
          allocations: [
            { sourceType: "inventory_lot", sourceId: lotId, quantity: "8" },
          ],
        }),
      }
    );
    expect(allocationResponse.status).toBe(200);

    const confirmedOpenOrder = await confirmOrder(unmanagedOrderId);
    expect(confirmedOpenOrder.status).toBe(200);

    const draftHeldAllocations = await getActiveAllocations(db, draftHeldLine.id);
    expect(draftHeldAllocations).toMatchObject([
      {
        sourceType: "inventory_lot",
        sourceId: lotId,
        quantity: "8.0000",
        status: "active",
      },
    ]);

    await expect
      .poll(async () => {
        const balance = await getItemBalance(db, item.id);
        return {
          committed: balance.committedQty,
          demand: balance.demandQty,
          shortage: balance.shortageQty,
          reservation: await getReservationTotal(db, item.id),
          demandSummary: await getDemandTotal(db, item.id),
        };
      })
      .toEqual({
        committed: "10.0000",
        demand: "18.0000",
        shortage: "8.0000",
        reservation: "10.0000",
        demandSummary: "18.0000",
      });

    const draftHeldConfirm = await confirmOrder(draftHeldOrderId);
    expect(draftHeldConfirm.status).toBe(200);

    await expect
      .poll(async () => {
        const balance = await getItemBalance(db, item.id);
        return {
          committed: balance.committedQty,
          demand: balance.demandQty,
          shortage: balance.shortageQty,
          reservation: await getReservationTotal(db, item.id),
          demandSummary: await getDemandTotal(db, item.id),
        };
      })
      .toEqual({
        committed: "10.0000",
        demand: "18.0000",
        shortage: "8.0000",
        reservation: "10.0000",
        demandSummary: "18.0000",
      });

    const [unmanagedOrder] = await db
      .select({ status: salesOrders.status, orderNumber: salesOrders.orderNumber })
      .from(salesOrders)
      .where(eq(salesOrders.id, unmanagedOrderId));
    expect(unmanagedOrder).toMatchObject({
      status: "confirmed",
      orderNumber: unmanagedOrderNumber,
    });
  });

  test("unmanaged confirmation does not take draft allocations when free stock covers it", async ({
    db,
  }) => {
    const customerId = await createCustomerFixture("Slow allocation free stock customer");
    const item = await createMaterialFixture({
      namePrefix: "Slow allocation free stock item",
      stock: "20",
    });
    const draftHeldOrderId = await createDraftOrder({
      customerId,
      itemId: item.id,
      quantity: "8",
      shipDate: "2026-05-25",
    });
    const unmanagedOrderId = await createDraftOrder({
      customerId,
      itemId: item.id,
      quantity: "10",
      shipDate: "2026-05-26",
    });
    const draftHeldLine = await getLine(db, draftHeldOrderId);
    const lotId = await getFirstLotId(db, item.id);

    const allocationResponse = await testFetch(
      `/api/sales-order-lines/${draftHeldLine.id}/allocation`,
      {
        method: "PUT",
        body: JSON.stringify({
          allocations: [
            { sourceType: "inventory_lot", sourceId: lotId, quantity: "8" },
          ],
        }),
      }
    );
    expect(allocationResponse.status).toBe(200);

    const confirmResult = await confirmOrder(unmanagedOrderId);
    expect(confirmResult.status).toBe(200);

    expect(await getActiveAllocations(db, draftHeldLine.id)).toMatchObject([
      {
        sourceType: "inventory_lot",
        sourceId: lotId,
        quantity: "8.0000",
        status: "active",
      },
    ]);

    await expect
      .poll(async () => {
        const balance = await getItemBalance(db, item.id);
        return {
          committed: balance.committedQty,
          demand: balance.demandQty,
          shortage: balance.shortageQty,
          reservation: await getReservationTotal(db, item.id),
          demandSummary: await getDemandTotal(db, item.id),
        };
      })
      .toEqual({
        committed: "18.0000",
        demand: "18.0000",
        shortage: "0.0000",
        reservation: "18.0000",
        demandSummary: "18.0000",
      });
  });

  test("source over-allocation is rejected without changing prior allocations", async ({
    db,
  }) => {
    const customerId = await createCustomerFixture("Slow allocation conflict customer");
    const item = await createMaterialFixture({
      namePrefix: "Slow allocation conflict item",
      stock: "5",
    });
    const firstOrderId = await createDraftOrder({
      customerId,
      itemId: item.id,
      quantity: "5",
    });
    const secondOrderId = await createDraftOrder({
      customerId,
      itemId: item.id,
      quantity: "5",
    });
    const firstLine = await getLine(db, firstOrderId);
    const secondLine = await getLine(db, secondOrderId);
    const lotId = await getFirstLotId(db, item.id);

    const firstAllocation = await testFetch(
      `/api/sales-order-lines/${firstLine.id}/allocation`,
      {
        method: "PUT",
        body: JSON.stringify({
          allocations: [
            { sourceType: "inventory_lot", sourceId: lotId, quantity: "5" },
          ],
        }),
      }
    );
    expect(firstAllocation.status).toBe(200);

    const invalidAllocation = await testFetch(
      `/api/sales-order-lines/${secondLine.id}/allocation`,
      {
        method: "PUT",
        body: JSON.stringify({
          allocations: [
            { sourceType: "inventory_lot", sourceId: lotId, quantity: "1" },
          ],
        }),
      }
    );
    expect(invalidAllocation.status).toBe(409);
    const invalidAllocationBody = await invalidAllocation.json();
    expect(invalidAllocationBody.error).toMatch(/only has 0/i);

    expect(await getActiveAllocations(db, firstLine.id)).toMatchObject([
      {
        sourceType: "inventory_lot",
        sourceId: lotId,
        quantity: "5.0000",
        status: "active",
      },
    ]);
    expect(await getActiveAllocations(db, secondLine.id)).toHaveLength(0);

    const balance = await getItemBalance(db, item.id);
    expect(balance.committedQty).toBe("5.0000");
    expect(balance.demandQty).toBe("10.0000");
  });

  test("editing a draft order with allocations cancels old allocation rows", async ({
    db,
  }) => {
    const customerId = await createCustomerFixture("Slow allocation edit customer");
    const item = await createMaterialFixture({
      namePrefix: "Slow allocation edit item",
      stock: "10",
    });
    const orderId = await createDraftOrder({
      customerId,
      itemId: item.id,
      quantity: "6",
    });
    const originalLine = await getLine(db, orderId);
    const lotId = await getFirstLotId(db, item.id);

    const allocationResponse = await testFetch(
      `/api/sales-order-lines/${originalLine.id}/allocation`,
      {
        method: "PUT",
        body: JSON.stringify({
          allocations: [
            { sourceType: "inventory_lot", sourceId: lotId, quantity: "4" },
          ],
        }),
      }
    );
    expect(allocationResponse.status).toBe(200);

    const editResponse = await testFetch(`/api/sales-orders/${orderId}`, {
      method: "PUT",
      body: JSON.stringify({
        customerId,
        status: "draft",
        shipDate: "2026-05-20",
        lines: [{ itemId: item.id, quantity: "7", unitPrice: "10" }],
      }),
    });
    const editBody = await editResponse.json().catch(() => null);
    expect(editResponse.status).toBe(200);
    expect(editBody?.id).toBe(orderId);

    expect(await getActiveAllocations(db, originalLine.id)).toHaveLength(0);

    const replacementLine = await getLine(db, orderId);
    expect(replacementLine.id).not.toBe(originalLine.id);
    expect(await getActiveAllocations(db, replacementLine.id)).toHaveLength(0);

    const balance = await getItemBalance(db, item.id);
    expect(balance.committedQty).toBe("0.0000");
    expect(balance.demandQty).toBe("0.0000");
  });
});
