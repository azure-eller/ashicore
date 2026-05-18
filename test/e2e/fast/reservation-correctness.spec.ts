import { and, eq, sql } from "drizzle-orm";
import { test, expect, selectDate } from "../fixtures";
import {
  inventoryDemandSummary,
  inventoryItemBalances,
  inventoryLotBalances,
  inventoryReservationsSummary,
  lots,
  manufacturingOrderIngredients,
  salesOrders,
} from "../../../lib/db/schema";
import {
  confirmSalesOrder,
  createCustomer,
  createItem,
  createManufacturingOrder,
  createSalesOrder,
  getUnitId,
  releaseManufacturingOrder,
  testFetch,
  updateItem,
  updateSalesOrder,
} from "../../helpers/api";
import type { TestDb } from "../fixtures";

function uniqueName(prefix: string) {
  return `${prefix} ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`;
}

function itemSku(name: string) {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 48);
}

function utcDateDaysFromToday(days: number) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

async function createMaterial(name: string, stock: string) {
  const result = await createItem({
    name,
    itemType: "material",
    unitDefinitionId: getUnitId(),
    sku: itemSku(name),
    category: "Reservation correctness",
    description: null,
    defaultPurchasePrice: "1.00",
    defaultSellingPrice: "9.00",
    stock,
    safetyStock: "0",
    bom: [],
  });

  expect(result.status).toBe(201);
  return result.body.id as string;
}

async function createBomProduct(
  name: string,
  componentId: string,
  quantityPerUnit: string,
  minimumLotAgeDays?: number
) {
  const result = await createItem({
    name,
    itemType: "product",
    unitDefinitionId: getUnitId(),
    sku: itemSku(name),
    category: "Reservation correctness",
    description: null,
    defaultPurchasePrice: null,
    defaultSellingPrice: "20.00",
    stock: "0",
    safetyStock: "0",
    bom: [{ componentId, quantity: quantityPerUnit, minimumLotAgeDays }],
  });

  expect(result.status).toBe(201);
  return result.body.id as string;
}

async function createCustomerFixture(name: string) {
  const result = await createCustomer({ name });
  expect(result.status).toBe(201);
  return result.body.id as string;
}

async function createOpenSalesOrder(params: {
  customerId: string;
  itemId: string;
  quantity: string;
  confirmOversell?: boolean;
}) {
  const result = await createSalesOrder({
    customerId: params.customerId,
    status: "open",
    lines: [
      {
        itemId: params.itemId,
        quantity: params.quantity,
        unitPrice: "9.00",
      },
    ],
    confirmOversell: params.confirmOversell,
  });

  expect(result.status).toBe(201);
  return result.body.id as string;
}

async function getItemBalance(db: TestDb, itemId: string) {
  const [balance] = await db
    .select({
      onHandQty: inventoryItemBalances.onHandQty,
      committedQty: inventoryItemBalances.committedQty,
      demandQty: inventoryItemBalances.demandQty,
      shortageQty: inventoryItemBalances.shortageQty,
      availableToPromise: inventoryItemBalances.availableToPromise,
    })
    .from(inventoryItemBalances)
    .where(eq(inventoryItemBalances.itemId, itemId));

  if (!balance) {
    throw new Error(`Missing inventory balance for item ${itemId}`);
  }

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

async function setLotDisposition(
  db: TestDb,
  itemId: string,
  disposition: "available" | "blocked" | "rejected"
) {
  const [current] = await db
    .select({
      lotId: inventoryLotBalances.lotId,
      currentDisposition: inventoryLotBalances.disposition,
      quantity: inventoryLotBalances.quantity,
    })
    .from(inventoryLotBalances)
    .where(
      and(
        eq(inventoryLotBalances.itemId, itemId),
        sql`${inventoryLotBalances.quantity} > 0`
      )
    );

  if (!current || current.currentDisposition === disposition) {
    return;
  }

  const action = {
    available: "release",
    blocked: "block",
    rejected: "reject",
  }[disposition];
  const response = await testFetch(
    `/api/items/${itemId}/lots/${current.lotId}/disposition`,
    {
      method: "POST",
      body: JSON.stringify({
        action,
        fromDisposition: current.currentDisposition,
        quantity: current.quantity,
        notes: null,
      }),
    }
  );

  expect(response.status).toBe(200);
}

test.describe("Reservation correctness", () => {
  test("sales order creation records backorder demand without over-reserving stock", async ({
    db,
  }) => {
    const customerId = await createCustomerFixture(uniqueName("Reservation customer"));
    const itemId = await createMaterial(uniqueName("Limited sales material"), "4");

    const orderResult = await createSalesOrder({
      customerId,
      status: "open",
      lines: [{ itemId, quantity: "10", unitPrice: "9.00" }],
      confirmOversell: false,
    });
    expect(orderResult.status).toBe(201);
    const orderId = orderResult.body.id as string;

    const [order] = await db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, orderId));
    expect(order.status).toBe("open");

    const balance = await getItemBalance(db, itemId);
    expect(balance.committedQty).toBe("4.0000");
    expect(balance.demandQty).toBe("10.0000");
    expect(balance.shortageQty).toBe("6.0000");
    expect(balance.availableToPromise).toBe("-6.0000");
    expect(await getReservationTotal(db, itemId)).toBe("4.0000");
    expect(await getDemandTotal(db, itemId)).toBe("10.0000");
  });

  test("full reservation flow still hard-reserves all available demand", async ({
    db,
  }) => {
    const customerId = await createCustomerFixture(uniqueName("Full reservation customer"));
    const itemId = await createMaterial(uniqueName("Full reservation material"), "6");
    const orderId = await createOpenSalesOrder({
      customerId,
      itemId,
      quantity: "6",
    });

    const confirmed = await confirmSalesOrder(orderId);
    expect(confirmed.status).toBe(200);

    const balance = await getItemBalance(db, itemId);
    expect(balance.onHandQty).toBe("6.0000");
    expect(balance.committedQty).toBe("6.0000");
    expect(balance.demandQty).toBe("6.0000");
    expect(balance.shortageQty).toBe("0.0000");
    expect(balance.availableToPromise).toBe("0.0000");
    expect(await getReservationTotal(db, itemId)).toBe("6.0000");
  });

  test("confirmed sales order edits refresh reservations atomically", async ({
    db,
  }) => {
    const customerId = await createCustomerFixture(uniqueName("Confirmed edit customer"));
    const itemId = await createMaterial(uniqueName("Confirmed edit material"), "5");
    const orderId = await createOpenSalesOrder({
      customerId,
      itemId,
      quantity: "3",
    });
    expect((await confirmSalesOrder(orderId)).status).toBe(200);

    const confirmedEdit = await updateSalesOrder(orderId, {
      customerId,
      status: "open",
      shipDate: "2026-04-15",
      lines: [{ itemId, quantity: "7", unitPrice: "9.00" }],
      confirmOversell: false,
    });
    expect(confirmedEdit.status).toBe(200);

    const balance = await getItemBalance(db, itemId);
    expect(balance.committedQty).toBe("5.0000");
    expect(balance.demandQty).toBe("7.0000");
    expect(balance.shortageQty).toBe("2.0000");
    expect(balance.availableToPromise).toBe("-2.0000");
    expect(await getReservationTotal(db, itemId)).toBe("5.0000");
    expect(await getDemandTotal(db, itemId)).toBe("7.0000");
  });

  test("available stock excludes existing reservations and blocked lots", async ({
    db,
  }) => {
    const customerId = await createCustomerFixture(uniqueName("ATP customer"));
    const itemId = await createMaterial(uniqueName("ATP material"), "5");
    const firstOrderId = await createOpenSalesOrder({
      customerId,
      itemId,
      quantity: "3",
    });
    const secondOrderId = await createOpenSalesOrder({
      customerId,
      itemId,
      quantity: "4",
    });

    expect((await confirmSalesOrder(firstOrderId)).status).toBe(200);
    expect((await confirmSalesOrder(secondOrderId, { confirmOversell: true })).status).toBe(200);

    const balance = await getItemBalance(db, itemId);
    expect(balance.committedQty).toBe("5.0000");
    expect(balance.demandQty).toBe("7.0000");
    expect(balance.shortageQty).toBe("2.0000");
    expect(balance.availableToPromise).toBe("-2.0000");
    expect(await getReservationTotal(db, itemId)).toBe("5.0000");

    const blockedItemId = await createMaterial(uniqueName("Blocked ATP material"), "5");
    await setLotDisposition(db, blockedItemId, "blocked");

    const blockedOrder = await createSalesOrder({
      customerId,
      status: "open",
      lines: [{ itemId: blockedItemId, quantity: "5", unitPrice: "9.00" }],
      confirmOversell: false,
    });
    expect(blockedOrder.status).toBe(201);

    const blockedBalance = await getItemBalance(db, blockedItemId);
    expect(blockedBalance.committedQty).toBe("0.0000");
    expect(blockedBalance.demandQty).toBe("5.0000");
    expect(blockedBalance.shortageQty).toBe("5.0000");
    expect(blockedBalance.availableToPromise).toBe("-5.0000");
  });

  test("released lots can be reserved, while blocked lots cannot", async ({
    db,
  }) => {
    const customerId = await createCustomerFixture(uniqueName("Lot status customer"));

    const releasedItemId = await createMaterial(uniqueName("Released material"), "4");
    await setLotDisposition(db, releasedItemId, "blocked");
    await setLotDisposition(db, releasedItemId, "available");
    const releasedOrderId = await createOpenSalesOrder({
      customerId,
      itemId: releasedItemId,
      quantity: "4",
    });
    expect((await confirmSalesOrder(releasedOrderId)).status).toBe(200);
    const releasedBalance = await getItemBalance(db, releasedItemId);
    expect(releasedBalance.committedQty).toBe("4.0000");
    expect(releasedBalance.availableToPromise).toBe("0.0000");

    const blockedItemId = await createMaterial(uniqueName("Blocked material"), "4");
    await setLotDisposition(db, blockedItemId, "blocked");
    await createOpenSalesOrder({
      customerId,
      itemId: blockedItemId,
      quantity: "4",
      confirmOversell: true,
    });
    const blockedBalance = await getItemBalance(db, blockedItemId);
    expect(blockedBalance.committedQty).toBe("0.0000");
    expect(blockedBalance.shortageQty).toBe("4.0000");
    expect(blockedBalance.availableToPromise).toBe("-4.0000");
  });

  test("manufacturing release records raw-material demand without hard-reserving", async ({
    db,
  }) => {
    const materialId = await createMaterial(uniqueName("MO constrained material"), "3");
    const productId = await createBomProduct(
      uniqueName("MO reservation product"),
      materialId,
      "2"
    );
    const released = await createManufacturingOrder({
      productId,
      plannedQuantity: "3",
      ingredients: [{ itemId: materialId, quantityPerUnit: "2" }],
    });
    expect(released.status).toBe(201);
    const orderId = released.body.id as string;
    const release = await releaseManufacturingOrder(orderId, {
      confirmShortage: true,
    });
    expect(release.status).toBe(200);

    const balance = await getItemBalance(db, materialId);
    expect(balance.committedQty).toBe("0.0000");
    expect(balance.demandQty).toBe("6.0000");
    expect(balance.shortageQty).toBe("6.0000");
    expect(balance.availableToPromise).toBe("-3.0000");
    expect(await getReservationTotal(db, materialId)).toBe("0");
    expect(await getDemandTotal(db, materialId)).toBe("6.0000");

    const [ingredient] = await db
      .select({ id: manufacturingOrderIngredients.id })
      .from(manufacturingOrderIngredients)
      .where(
        and(
          eq(manufacturingOrderIngredients.manufacturingOrderId, orderId),
          eq(manufacturingOrderIngredients.itemId, materialId)
        )
      );
    expect(ingredient.id).toBeTruthy();
  });

  test("manufacturing lot-age release succeeds when eligible stock remains", async ({
    db,
  }) => {
    const materialName = uniqueName("Age reserved material");
    const materialId = await createMaterial(materialName, "5");

    await db
      .update(lots)
      .set({ receivedAt: utcDateDaysFromToday(-8) })
      .where(eq(lots.itemId, materialId));
    await db
      .update(inventoryLotBalances)
      .set({ receivedAt: utcDateDaysFromToday(-8) })
      .where(eq(inventoryLotBalances.itemId, materialId));

    const updateResult = await updateItem(materialId, {
      name: materialName,
      purchaseUnitDefinitionId: null,
      purchaseToStockFactor: null,
      sku: itemSku(materialName),
      category: "Reservation correctness",
      description: null,
      defaultPurchasePrice: "1.00",
      currentStockUnitCost: "1.00",
      defaultSellingPrice: "9.00",
      sellable: true,
      manufacturingMode: "discrete",
      expectedBatchYield: null,
      stock: "13",
      safetyStock: "0",
      bom: [],
      revisionNote: null,
    });
    expect(updateResult.status).toBe(200);

    const customerId = await createCustomerFixture(uniqueName("Age reserved customer"));
    const reservationOrder = await createSalesOrder({
      customerId,
      status: "open",
      lines: [{ itemId: materialId, quantity: "4", unitPrice: "9" }],
    });
    expect(reservationOrder.status).toBe(201);

    const productId = await createBomProduct(
      uniqueName("Age reserved product"),
      materialId,
      "1",
      7
    );
    const order = await createManufacturingOrder({
      productId,
      plannedQuantity: "5",
      ingredients: [{ itemId: materialId, quantityPerUnit: "1" }],
    });
    expect(order.status).toBe(201);
    const release = await releaseManufacturingOrder(order.body.id as string);
    expect(release.status).toBe(200);
  });

  test("concurrent sales confirmations cannot reserve the same stock twice", async ({
    db,
  }) => {
    const customerId = await createCustomerFixture(uniqueName("Concurrent customer"));
    const itemId = await createMaterial(uniqueName("Concurrent material"), "5");
    const firstOrderId = await createOpenSalesOrder({
      customerId,
      itemId,
      quantity: "5",
    });
    const secondOrderId = await createOpenSalesOrder({
      customerId,
      itemId,
      quantity: "5",
      confirmOversell: true,
    });

    const results = await Promise.all([
      confirmSalesOrder(firstOrderId, { confirmOversell: true }),
      confirmSalesOrder(secondOrderId, { confirmOversell: true }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 200]);

    const balance = await getItemBalance(db, itemId);
    expect(balance.committedQty).toBe("5.0000");
    expect(balance.demandQty).toBe("10.0000");
    expect(balance.shortageQty).toBe("5.0000");
    expect(balance.availableToPromise).toBe("-5.0000");
    expect(await getReservationTotal(db, itemId)).toBe("5.0000");
    expect(await getDemandTotal(db, itemId)).toBe("10.0000");
  });

  test("browser confirmation shows partial reservation and backorder state", async ({
    page,
    db,
  }) => {
    const customerName = uniqueName("Browser reservation customer");
    const materialName = uniqueName("Browser constrained material");
    const customerId = await createCustomerFixture(customerName);
    const itemId = await createMaterial(materialName, "2");

    await page.goto("/sales/orders/new");
    await expect(page.getByText("Add Sales Order")).toBeVisible();

    const customerInput = page.getByPlaceholder("Search customers...");
    await customerInput.click();
    await customerInput.pressSequentially(customerName);
    await page.getByRole("option", { name: new RegExp(customerName) }).click();

    const itemInput = page.getByPlaceholder("Search items...").first();
    await itemInput.click();
    await itemInput.pressSequentially(materialName);
    await page.getByRole("option", { name: new RegExp(materialName) }).click();
    await selectDate(page, page.getByLabel("Order Date"), "2026-04-01");
    await page.locator('input[placeholder="0"]').first().fill("5");
    await page.locator('input[placeholder="0.00"]').first().fill("9.00");

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

    await expect(
      page.locator("main").getByText("Open", { exact: true }).first()
    ).toBeVisible({ timeout: 15000 });

    const balance = await getItemBalance(db, itemId);
    expect(balance.committedQty).toBe("2.0000");
    expect(balance.demandQty).toBe("5.0000");
    expect(balance.shortageQty).toBe("3.0000");
    expect(balance.availableToPromise).toBe("-3.0000");
    expect(await getReservationTotal(db, itemId)).toBe("2.0000");

    expect(customerId).toBeTruthy();
  });

  test("item detail shows stock commitments by customer", async ({ page }) => {
    const customerName = uniqueName("Commitment card customer");
    const materialName = uniqueName("Commitment card material");
    const customerId = await createCustomerFixture(customerName);
    const itemId = await createMaterial(materialName, "8");
    const orderId = await createOpenSalesOrder({
      customerId,
      itemId,
      quantity: "3",
    });

    expect((await confirmSalesOrder(orderId)).status).toBe(200);

    await page.goto(`/inventory/materials/${itemId}`);
    const commitmentCard = page
      .locator('[data-slot="card"]')
      .filter({ hasText: "Stock Commitments" });
    await expect(commitmentCard).toBeVisible();
    await expect(commitmentCard.getByText("Available").first()).toBeVisible();
    await expect(commitmentCard.getByText(customerName)).toBeVisible();
    await expect(commitmentCard.getByText("8").first()).toBeVisible();
  });
});
