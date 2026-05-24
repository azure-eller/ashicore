import { and, eq } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  inventoryDemandSummary,
  inventoryEvents,
  inventoryItemBalances,
  salesOrderLines,
  salesOrders,
} from "../../../lib/db/schema";
import { testFetch } from "../../helpers/api";
import {
  createConfirmedSalesOrder,
  createCustomerFixture,
  createMaterialFixture,
  createSellableProductFixture,
  readSalesOrder,
  readSalesOrderLine,
  searchOrderList,
} from "./story-helpers";

test.describe("sales fulfillment operating story", () => {
  test.describe.configure({ mode: "serial" });

  let productId: string;
  let componentId: string;
  let customerId: string;
  let orderId: string;
  let orderNumber: string;

  test("creates customer context and sales demand without consuming stock", async ({ db, page }) => {
    const component = await createMaterialFixture({
      name: "Sales Story Component",
      stock: "25",
      cost: "3.00",
    });
    const product = await createSellableProductFixture({
      name: "Sales Story Product",
      stock: "10",
      price: "18.00",
      bom: [{ componentId: component.id, quantity: "1" }],
    });
    productId = product.id;
    componentId = component.id;

    const customer = await createCustomerFixture({
      name: "Sales Story Customer",
      email: "fulfillment@example.com",
      shipLine1: "44 Fulfillment Road",
      shipCity: "Crawford",
      shipRegion: "CO",
      shipPostcode: "81415",
    });
    customerId = customer.id;

    orderId = await createConfirmedSalesOrder({
      customerId,
      productId,
      quantity: "6",
      unitPrice: "18.00",
    });
    const order = await readSalesOrder(db, orderId);
    orderNumber = order.orderNumber;

    expect(order).toMatchObject({
      customerId,
      customerName: customer.name,
    });

    const line = await readSalesOrderLine(db, orderId, productId);
    const [demand] = await db
      .select({ quantity: inventoryDemandSummary.quantity })
      .from(inventoryDemandSummary)
      .where(
        and(
          eq(inventoryDemandSummary.itemId, productId),
          eq(inventoryDemandSummary.referenceType, "sales_order_line"),
          eq(inventoryDemandSummary.referenceId, line.id)
        )
      );
    expect(demand.quantity).toBe("6.0000");

    const [balance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        demandQty: inventoryItemBalances.demandQty,
        availableToPromise: inventoryItemBalances.availableToPromise,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, productId));
    expect(balance).toMatchObject({
      onHandQty: "10.0000",
      demandQty: "6.0000",
      availableToPromise: "4.0000",
    });

    const row = await searchOrderList(page, orderNumber);
    await expect(row).toContainText(customer.name);
  });

  test("partial shipment keeps the order open and consumes only shipped stock", async ({ db, page }) => {
    const line = await readSalesOrderLine(db, orderId, productId);
    const ship = await testFetch(`/api/sales-orders/${orderId}/ship`, {
      method: "POST",
      body: JSON.stringify({
        syncAccounting: false,
        lines: [{ salesOrderLineId: line.id, quantity: "3" }],
      }),
    });
    expect(ship.status).toBe(200);

    const [order] = await db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, orderId));
    expect(order.status).toBe("open");

    const [balance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        demandQty: inventoryItemBalances.demandQty,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, productId));
    expect(balance).toMatchObject({
      onHandQty: "7.0000",
      demandQty: "3.0000",
    });

    const events = await db
      .select({ quantity: inventoryEvents.quantity })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, productId),
          eq(inventoryEvents.eventType, "sales_consumption")
        )
      );
    expect(events.map((event) => event.quantity)).toEqual(["3.0000"]);

    const row = await searchOrderList(page, orderNumber);
    await expect(row).toContainText(orderNumber);
  });

  test("final shipment closes demand and consumes stock once", async ({ db }) => {
    const line = await readSalesOrderLine(db, orderId, productId);
    const ship = await testFetch(`/api/sales-orders/${orderId}/ship`, {
      method: "POST",
      body: JSON.stringify({
        syncAccounting: false,
        lines: [{ salesOrderLineId: line.id, quantity: "3" }],
      }),
    });
    expect(ship.status).toBe(200);

    const [balance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        demandQty: inventoryItemBalances.demandQty,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, productId));
    expect(balance).toMatchObject({
      onHandQty: "4.0000",
      demandQty: "0.0000",
    });

    const events = await db
      .select({ quantity: inventoryEvents.quantity })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, productId),
          eq(inventoryEvents.eventType, "sales_consumption")
        )
      );
    expect(events.map((event) => event.quantity).sort()).toEqual(["3.0000", "3.0000"]);

    const [order] = await db
      .select({
        status: salesOrders.status,
        shipLine1: salesOrders.shipLine1,
        shipCity: salesOrders.shipCity,
      })
      .from(salesOrders)
      .where(eq(salesOrders.id, orderId));
    expect(order.status).toBe("done");
    expect(order.shipLine1).toBe("44 Fulfillment Road");
    expect(order.shipCity).toBe("Crawford");

    const lines = await db
      .select({ cancelledQuantity: salesOrderLines.cancelledQuantity })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, orderId));
    expect(lines[0].cancelledQuantity).toBe("0.0000");
  });

  test("deleting a confirmed order releases committed stock", async ({ db }) => {
    const deleteOrderId = await createConfirmedSalesOrder({
      customerId,
      productId,
      quantity: "2",
      unitPrice: "18.00",
    });

    const [productBefore] = await db
      .select({ committedQty: inventoryItemBalances.committedQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, productId));
    expect(Number(productBefore.committedQty)).toBeGreaterThan(0);

    const deleteResponse = await testFetch(`/api/sales-orders/${deleteOrderId}`, {
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(200);

    const [deletedOrder] = await db
      .select({ deletedAt: salesOrders.deletedAt })
      .from(salesOrders)
      .where(eq(salesOrders.id, deleteOrderId));
    expect(deletedOrder.deletedAt).toBeTruthy();

    const [productAfter] = await db
      .select({ committedQty: inventoryItemBalances.committedQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, productId));
    const [componentAfter] = await db
      .select({ committedQty: inventoryItemBalances.committedQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, componentId));
    expect(productAfter.committedQty).toBe("0.0000");
    expect(componentAfter.committedQty).toBe("0.0000");
  });
});
