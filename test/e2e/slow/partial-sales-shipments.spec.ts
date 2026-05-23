import { and, eq, sql } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  inventoryDemandSummary,
  inventoryEvents,
  inventoryItemBalances,
  inventoryReservationsSummary,
  salesOrderLines,
  salesOrders,
} from "../../../lib/db/schema";
import {
  confirmSalesOrder,
  createCustomer,
  createItem,
  createSalesOrder,
  getUnitId,
  testFetch,
} from "../../helpers/api";
import type { TestDb } from "../fixtures";

function uniqueName(prefix: string) {
  return `${prefix} ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`;
}

async function createMaterial(name: string, stock: string) {
  const result = await createItem({
    name,
    itemType: "material",
    unitDefinitionId: getUnitId(),
    sku: name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 48),
    category: "Partial sales shipments",
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

async function createCustomerFixture(name: string) {
  const result = await createCustomer({ name });
  expect(result.status).toBe(201);
  return result.body.id as string;
}

async function createDraftSalesOrder(params: {
  customerId: string;
  itemId: string;
  quantity: string;
}) {
  const result = await createSalesOrder({
    customerId: params.customerId,
    status: "open",
    shipDate: "2026-04-15",
    lines: [
      {
        itemId: params.itemId,
        quantity: params.quantity,
        unitPrice: "9.00",
      },
    ],
    shipments: [],
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

test.describe("Partial sales shipments", () => {
  test.describe.configure({ mode: "serial" });

  test("consume and release only shipped quantities", async ({ page, db }) => {
    const customerName = uniqueName("Partial shipment customer");
    const itemName = uniqueName("Partial shipment material");
    const customerId = await createCustomerFixture(customerName);
    const itemId = await createMaterial(itemName, "10");
    const orderId = await createDraftSalesOrder({
      customerId,
      itemId,
      quantity: "10",
    });

    expect((await confirmSalesOrder(orderId)).status).toBe(200);

    const [orderHeader] = await db
      .select({ orderNumber: salesOrders.orderNumber })
      .from(salesOrders)
      .where(eq(salesOrders.id, orderId));

    await page.goto(`/sales/orders/${orderId}`);
    await expect(page.getByRole("heading", { name: orderHeader.orderNumber })).toBeVisible();
    await expect(page.locator("main").getByText(/Not shipped|Partially shipped/).first()).toBeVisible();
    await expect(page.getByRole("grid").first()).toContainText(itemName);
    await expect(page.getByRole("grid").first()).toContainText("10");

    const [line] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, orderId));

    const shipFirst = await testFetch(`/api/sales-orders/${orderId}/ship`, {
      method: "POST",
      body: JSON.stringify({
        syncAccounting: false,
        lines: [{ salesOrderLineId: line.id, quantity: "4" }],
      }),
    });
    expect(shipFirst.status).toBe(200);

    const [partialOrder] = await db
      .select({ status: salesOrders.status, shippedAt: salesOrders.shippedAt })
      .from(salesOrders)
      .where(eq(salesOrders.id, orderId));
    expect(partialOrder.status).toBe("open");
    expect(partialOrder.shippedAt).toBeNull();

    await page.goto(`/sales/orders/${orderId}`);
    await expect(page.locator("main").getByText("Partially shipped").first()).toBeVisible();
    await expect(page.getByRole("grid").first()).toContainText("4 shipped");

    let balance = await getItemBalance(db, itemId);
    expect(balance.onHandQty).toBe("6.0000");
    expect(balance.committedQty).toBe("6.0000");
    expect(balance.demandQty).toBe("6.0000");
    expect(await getReservationTotal(db, itemId)).toBe("6.0000");
    expect(await getDemandTotal(db, itemId)).toBe("6.0000");

    const [firstConsumption] = await db
      .select({
        referenceType: inventoryEvents.referenceType,
        referenceId: inventoryEvents.referenceId,
        quantity: inventoryEvents.quantity,
      })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.eventType, "sales_consumption"),
          eq(inventoryEvents.referenceId, orderId)
        )
      );
    expect(firstConsumption.referenceType).toBe("sales_order");
    expect(firstConsumption.quantity).toBe("4.0000");

    const overship = await testFetch(`/api/sales-orders/${orderId}/ship`, {
      method: "POST",
      body: JSON.stringify({
        syncAccounting: false,
        lines: [{ salesOrderLineId: line.id, quantity: "7" }],
      }),
    });
    expect(overship.status).toBe(400);

    const shipSecond = await testFetch(`/api/sales-orders/${orderId}/ship`, {
      method: "POST",
      body: JSON.stringify({
        syncAccounting: false,
        lines: [{ salesOrderLineId: line.id, quantity: "6" }],
      }),
    });
    expect(shipSecond.status).toBe(200);

    const [shippedOrder] = await db
      .select({ status: salesOrders.status, shippedAt: salesOrders.shippedAt })
      .from(salesOrders)
      .where(eq(salesOrders.id, orderId));
    expect(shippedOrder.status).toBe("done");
    expect(shippedOrder.shippedAt).not.toBeNull();

    await page.goto(`/sales/orders/${orderId}`);
    await expect(page.locator("main").getByText("Shipped", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("grid").first()).toContainText("10 shipped");

    balance = await getItemBalance(db, itemId);
    expect(balance.onHandQty).toBe("0.0000");
    expect(balance.committedQty).toBe("0.0000");
    expect(balance.demandQty).toBe("0.0000");
    expect(await getReservationTotal(db, itemId)).toBe("0");
    expect(await getDemandTotal(db, itemId)).toBe("0");
  });
});
