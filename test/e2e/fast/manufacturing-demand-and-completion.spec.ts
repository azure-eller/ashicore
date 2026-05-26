import { and, eq } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  inventoryDemandSummary,
  inventoryEvents,
  inventoryItemBalances,
  manufacturingOrderIngredients,
  manufacturingOrders,
} from "../../../lib/db/schema";
import {
  completeManufacturingOrder,
  createItem,
  createManufacturingOrder,
  getUnitId,
  releaseManufacturingOrder,
  testFetch,
} from "../../helpers/api";

test.describe("manufacturing demand and completion heartbeat", () => {
  const ts = Date.now();
  const unitId = getUnitId();

  async function createBomFixture(label: string) {
    const component = await createItem({
      itemType: "material",
      name: `Fast MO ${label} Component ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-MO-${label}-COMP-${ts}`,
      category: `Fast Manufacturing ${ts}`,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "10",
      safetyStock: "0",
      bom: [],
    });
    expect(component.status).toBe(201);

    const product = await createItem({
      itemType: "product",
      name: `Fast MO ${label} Product ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-MO-${label}-PRODUCT-${ts}`,
      category: `Fast Manufacturing ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "20.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: component.body.id, quantity: "2" }],
    });
    expect(product.status).toBe(201);

    return {
      componentId: component.body.id as string,
      productId: product.body.id as string,
    };
  }

  async function pickAllIngredients(orderId: string) {
    const execution = await testFetch(`/api/manufacturing-orders/${orderId}/execution`);
    expect(execution.status).toBe(200);
    const body = await execution.json();

    for (const ingredient of body.ingredients ?? []) {
      const pick = await testFetch(
        `/api/manufacturing-orders/${orderId}/ingredients/${ingredient.id}/pick`,
        {
          method: "POST",
          body: JSON.stringify({}),
        }
      );
      expect(pick.status).toBe(200);
    }
  }

  test("released manufacturing order creates ingredient demand", async ({ db }) => {
    const fixture = await createBomFixture("Demand");
    const order = await createManufacturingOrder({
      productId: fixture.productId,
      plannedQuantity: "3",
      ingredients: [{ itemId: fixture.componentId, quantityPerUnit: "2" }],
      confirmShortage: false,
    });
    expect(order.status).toBe(201);

    const release = await releaseManufacturingOrder(order.body.id);
    expect(release.status).toBe(200);

    const [ingredient] = await db
      .select({ id: manufacturingOrderIngredients.id })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, order.body.id));
    const [demand] = await db
      .select({ quantity: inventoryDemandSummary.quantity })
      .from(inventoryDemandSummary)
      .where(
        and(
          eq(inventoryDemandSummary.itemId, fixture.componentId),
          eq(inventoryDemandSummary.referenceType, "manufacturing_order_ingredient"),
          eq(inventoryDemandSummary.referenceId, ingredient.id)
        )
      );
    expect(demand.quantity).toBe("6.0000");
  });

  test("completion consumes ingredients once and produces output once", async ({
    db,
  }) => {
    const fixture = await createBomFixture("Complete");
    const order = await createManufacturingOrder({
      productId: fixture.productId,
      plannedQuantity: "3",
      ingredients: [{ itemId: fixture.componentId, quantityPerUnit: "2" }],
      confirmShortage: false,
    });
    expect(order.status).toBe(201);
    expect((await releaseManufacturingOrder(order.body.id)).status).toBe(200);
    await pickAllIngredients(order.body.id);

    const completion = await completeManufacturingOrder(order.body.id, "3");
    expect(completion.status).toBe(200);

    const componentEvents = await db
      .select({ quantity: inventoryEvents.quantity })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, fixture.componentId),
          eq(inventoryEvents.eventType, "manufacturing_ingredient_consumption")
        )
      );
    expect(componentEvents).toHaveLength(1);
    expect(componentEvents[0].quantity).toBe("6.0000");

    const outputEvents = await db
      .select({ quantity: inventoryEvents.quantity })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, fixture.productId),
          eq(inventoryEvents.eventType, "manufacturing_output")
        )
      );
    expect(outputEvents).toHaveLength(1);
    expect(outputEvents[0].quantity).toBe("3.0000");

    const [componentBalance] = await db
      .select({ onHandQty: inventoryItemBalances.onHandQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, fixture.componentId));
    const [productBalance] = await db
      .select({ onHandQty: inventoryItemBalances.onHandQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, fixture.productId));

    expect(componentBalance.onHandQty).toBe("4.0000");
    expect(productBalance.onHandQty).toBe("3.0000");

    const [savedOrder] = await db
      .select({ status: manufacturingOrders.status })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, order.body.id));
    expect(savedOrder.status).toBe("done");
  });

  test("confirmed completion can consume ingredients into negative stock", async ({
    db,
  }) => {
    const component = await createItem({
      itemType: "material",
      name: `Fast MO Negative Component ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-MO-NEG-COMP-${ts}`,
      category: `Fast Manufacturing ${ts}`,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(component.status).toBe(201);

    const product = await createItem({
      itemType: "product",
      name: `Fast MO Negative Product ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-MO-NEG-PRODUCT-${ts}`,
      category: `Fast Manufacturing ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "20.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: component.body.id, quantity: "2" }],
    });
    expect(product.status).toBe(201);

    const order = await createManufacturingOrder({
      productId: product.body.id,
      plannedQuantity: "1",
      ingredients: [{ itemId: component.body.id, quantityPerUnit: "2" }],
      confirmShortage: false,
    });
    expect(order.status).toBe(201);
    expect((await releaseManufacturingOrder(order.body.id)).status).toBe(200);

    const firstAttempt = await completeManufacturingOrder(order.body.id, "1");
    expect(firstAttempt.status).toBe(409);
    expect(firstAttempt.body?.shortage?.ingredients?.[0]?.warningType).toBe(
      "stock_shortage"
    );

    const confirmed = await completeManufacturingOrder(order.body.id, "1", {
      confirmNegativeStock: true,
    });
    expect(confirmed.status).toBe(200);

    const [componentBalance] = await db
      .select({ onHandQty: inventoryItemBalances.onHandQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, component.body.id));
    const [savedOrder] = await db
      .select({ status: manufacturingOrders.status })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, order.body.id));

    expect(componentBalance.onHandQty).toBe("-2.0000");
    expect(savedOrder.status).toBe("done");
  });
});
