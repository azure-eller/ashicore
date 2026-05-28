import { and, eq } from "drizzle-orm";
import { test, expect } from "../fixtures";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import {
  inventoryDemandSummary,
  inventoryEvents,
  inventoryItemBalances,
  inventoryReservationsSummary,
  lots,
  salesOrderLines,
  salesOrders,
  salesShipmentLines,
  salesShipments,
  stockAllocations,
} from "../../../lib/db/schema";
import {
  createCustomer,
  createItem,
  createSalesOrder,
  fulfillSalesOrder,
  getOrgId,
  getUnitId,
  testFetch,
} from "../../helpers/api";

test.describe("sales demand and shipment heartbeat", () => {
  const ts = Date.now();
  const orgId = getOrgId();
  const unitId = getUnitId();

  async function createStockedProduct(label: string, stock: string) {
    const component = await createItem({
      itemType: "material",
      name: `Fast Sales ${label} Component ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-SALES-${label}-COMP-${ts}`,
      category: `Fast Sales ${ts}`,
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
      name: `Fast Sales ${label} Product ${ts}`,
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-SALES-${label}-${ts}`,
      category: `Fast Sales ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "12.00",
      stock,
      safetyStock: "0",
      bom: [{ componentId: component.body.id, quantity: "1" }],
    });
    expect(product.status).toBe(201);

    return product.body.id as string;
  }

  test("sales order creates demand without consuming physical stock", async ({
    db,
  }) => {
    const productId = await createStockedProduct("Demand", "10");

    const customer = await createCustomer({ name: `Fast Sales Customer ${ts}` });
    expect(customer.status).toBe(201);

    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-01",
      shipDate: "2026-05-02",
      lines: [{ itemId: productId, quantity: "6", unitPrice: "12.00" }],
    });
    expect(order.status).toBe(201);

    const [line] = await db
      .select({ id: salesOrderLines.id, quantity: salesOrderLines.quantity })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id));
    expect(line.quantity).toBe("6.0000");

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
  });

  test("shipping consumes stock once and closes the order", async ({ db }) => {
    const productId = await createStockedProduct("Ship", "5");

    const customer = await createCustomer({ name: `Fast Ship Customer ${ts}` });
    expect(customer.status).toBe(201);
    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-03",
      shipDate: "2026-05-04",
      lines: [{ itemId: productId, quantity: "5", unitPrice: "15.00" }],
    });
    expect(order.status).toBe(201);

    const ship = await fulfillSalesOrder(order.body.id);
    expect(ship.status).toBe(200);

    const events = await db
      .select({ quantity: inventoryEvents.quantity })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, productId),
          eq(inventoryEvents.eventType, "sales_consumption")
        )
      );
    expect(events).toHaveLength(1);
    expect(events[0].quantity).toBe("5.0000");

    const [shipment] = await db
      .select({
        id: salesShipments.id,
        status: salesShipments.status,
        shipmentNumber: salesShipments.shipmentNumber,
      })
      .from(salesShipments)
      .where(eq(salesShipments.salesOrderId, order.body.id));
    expect(shipment).toMatchObject({
      status: "shipped",
      shipmentNumber: expect.stringMatching(/-S1$/),
    });

    const shipmentLines = await db
      .select({ quantity: salesShipmentLines.quantity })
      .from(salesShipmentLines)
      .where(eq(salesShipmentLines.salesShipmentId, shipment.id));
    expect(shipmentLines.map((line) => line.quantity)).toEqual(["5.0000"]);

    const [balance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        demandQty: inventoryItemBalances.demandQty,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, productId));
    expect(balance).toMatchObject({
      onHandQty: "0.0000",
      demandQty: "0.0000",
    });

    const [savedOrder] = await db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, order.body.id));
    expect(savedOrder.status).toBe("done");
  });

  test("partial shipping creates shipment history and leaves remaining demand", async ({
    db,
  }) => {
    const productId = await createStockedProduct("PartialShip", "8");

    const customer = await createCustomer({ name: `Fast Partial Ship Customer ${ts}` });
    expect(customer.status).toBe(201);
    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-03",
      shipDate: "2026-05-04",
      lines: [{ itemId: productId, quantity: "8", unitPrice: "15.00" }],
    });
    expect(order.status).toBe(201);

    const [line] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id));
    const ship = await testFetch(`/api/sales-orders/${order.body.id}/ship`, {
      method: "POST",
      headers: Object.fromEntries(createIdempotencyHeaders("shipSalesOrder").entries()),
      body: JSON.stringify({
        syncAccounting: false,
        lines: [{ salesOrderLineId: line.id, quantity: "3" }],
      }),
    });
    expect(ship.status).toBe(200);

    const [savedOrder] = await db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, order.body.id));
    expect(savedOrder.status).toBe("open");

    const [shipment] = await db
      .select({
        id: salesShipments.id,
        status: salesShipments.status,
        shipmentNumber: salesShipments.shipmentNumber,
      })
      .from(salesShipments)
      .where(eq(salesShipments.salesOrderId, order.body.id));
    expect(shipment).toMatchObject({
      status: "shipped",
      shipmentNumber: expect.stringMatching(/-S1$/),
    });

    const shipmentLines = await db
      .select({ quantity: salesShipmentLines.quantity })
      .from(salesShipmentLines)
      .where(eq(salesShipmentLines.salesShipmentId, shipment.id));
    expect(shipmentLines.map((shipmentLine) => shipmentLine.quantity)).toEqual([
      "3.0000",
    ]);

    const [balance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        demandQty: inventoryItemBalances.demandQty,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, productId));
    expect(balance).toMatchObject({
      onHandQty: "5.0000",
      demandQty: "5.0000",
    });
  });

  test("shipping can consume stock reserved by demand queue for another order", async ({
    db,
  }) => {
    const productId = await createStockedProduct("QueueShip", "50");
    const customer = await createCustomer({ name: `Fast Queue Ship Customer ${ts}` });
    expect(customer.status).toBe(201);

    const reservedOrder = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-05",
      shipDate: "2026-05-10",
      lines: [{ itemId: productId, quantity: "50", unitPrice: "15.00" }],
    });
    expect(reservedOrder.status).toBe(201);
    const shippingOrder = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-05",
      shipDate: "2026-05-06",
      lines: [{ itemId: productId, quantity: "50", unitPrice: "15.00" }],
    });
    expect(shippingOrder.status).toBe(201);

    const [reservedLine] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, reservedOrder.body.id));
    const [reserved] = await db
      .select({ quantity: inventoryReservationsSummary.quantity })
      .from(inventoryReservationsSummary)
      .where(eq(inventoryReservationsSummary.referenceId, reservedLine.id));
    expect(reserved.quantity).toBe("50.0000");

    const ship = await fulfillSalesOrder(shippingOrder.body.id);
    expect(ship.status).toBe(200);

    const [savedOrder] = await db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, shippingOrder.body.id));
    expect(savedOrder.status).toBe("done");
  });

  test("shipping warns before taking stock manually pinned to another order", async ({
    db,
  }) => {
    const productId = await createStockedProduct("PinnedShip", "50");
    const customer = await createCustomer({ name: `Fast Pinned Ship Customer ${ts}` });
    expect(customer.status).toBe(201);

    const pinnedOrder = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-07",
      shipDate: "2026-05-10",
      lines: [{ itemId: productId, quantity: "50", unitPrice: "15.00" }],
    });
    expect(pinnedOrder.status).toBe(201);
    const shippingOrder = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-07",
      shipDate: "2026-05-08",
      lines: [{ itemId: productId, quantity: "50", unitPrice: "15.00" }],
    });
    expect(shippingOrder.status).toBe(201);

    const [pinnedLine] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, pinnedOrder.body.id));
    const [lot] = await db
      .select({ id: lots.id })
      .from(lots)
      .where(eq(lots.itemId, productId));
    expect(lot?.id).toBeTruthy();

    await db.insert(stockAllocations).values({
      organizationId: orgId,
      demandType: "sales_order_line",
      demandId: pinnedLine.id,
      itemId: productId,
      sourceType: "inventory_lot",
      sourceId: lot.id,
      quantity: "50.0000",
      status: "active",
    });

    const ship = await fulfillSalesOrder(shippingOrder.body.id);
    expect(ship.status).toBe(409);
    expect(ship.body.negativeStock).toMatchObject({
      itemId: productId,
      reason: "commitment_conflict",
      committedToOthers: 50,
    });
    expect(ship.body.negativeStock.commitments[0]).toMatchObject({
      referenceType: "sales_order",
      referenceId: pinnedOrder.body.id,
      quantity: 50,
    });

    const confirmedShip = await testFetch(`/api/sales-orders/${shippingOrder.body.id}/ship`, {
      method: "POST",
      headers: Object.fromEntries(createIdempotencyHeaders("shipSalesOrder").entries()),
      body: JSON.stringify({ confirmNegativeStock: true }),
    });
    expect(confirmedShip.status).toBe(200);
  });
});
