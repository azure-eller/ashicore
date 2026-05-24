import { and, eq } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  inventoryDemandSummary,
  inventoryEvents,
  inventoryItemBalances,
  salesOrderLines,
  salesOrders,
} from "../../../lib/db/schema";
import {
  createCustomer,
  createItem,
  createSalesOrder,
  fulfillSalesOrder,
  getUnitId,
} from "../../helpers/api";

test.describe("sales demand and shipment heartbeat", () => {
  const ts = Date.now();
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
});
