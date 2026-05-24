import { and, eq } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  inventoryDemandSummary,
  inventoryEvents,
  inventoryItemBalances,
  inventoryLotBalances,
  lots,
  manufacturingOrderIngredients,
  manufacturingOrderOutputs,
  manufacturingOrders,
} from "../../../lib/db/schema";
import { completeManufacturingOrder, testFetch, updateItem } from "../../helpers/api";
import {
  createMaterialFixture,
  createReleasedManufacturingOrder,
  createSellableProductFixture,
  pickAllIngredients,
} from "./story-helpers";

test.describe("manufacturing execution operating story", () => {
  test.describe.configure({ mode: "serial" });

  let componentId: string;
  let productId: string;
  let orderId: string;

  test("creates BOM snapshot and releases ingredient demand", async ({ db, page }) => {
    const component = await createMaterialFixture({
      name: "Manufacturing Story Component",
      stock: "20",
      cost: "2.50",
    });
    componentId = component.id;
    const product = await createSellableProductFixture({
      name: "Manufacturing Story Product",
      stock: "0",
      price: "24.00",
      bom: [{ componentId, quantity: "2" }],
    });
    productId = product.id;

    orderId = await createReleasedManufacturingOrder({
      productId,
      componentId,
      plannedQuantity: "4",
      quantityPerUnit: "2",
    });

    const [ingredient] = await db
      .select({ id: manufacturingOrderIngredients.id })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, orderId));
    const [demand] = await db
      .select({ quantity: inventoryDemandSummary.quantity })
      .from(inventoryDemandSummary)
      .where(
        and(
          eq(inventoryDemandSummary.itemId, componentId),
          eq(inventoryDemandSummary.referenceType, "manufacturing_order_ingredient"),
          eq(inventoryDemandSummary.referenceId, ingredient.id)
        )
      );
    expect(demand.quantity).toBe("8.0000");

    await page.goto(`/manufacturing/orders/${orderId}`);
    await expect(page.locator("main")).toContainText(product.name);
  });

  test("picks ingredients before completion", async ({ db }) => {
    await pickAllIngredients(orderId);

    const [componentBalance] = await db
      .select({ onHandQty: inventoryItemBalances.onHandQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, componentId));
    expect(componentBalance.onHandQty).toBe("12.0000");

    const componentEvents = await db
      .select({ quantity: inventoryEvents.quantity })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, componentId),
          eq(inventoryEvents.eventType, "manufacturing_ingredient_consumption")
        )
      );
    expect(componentEvents).toHaveLength(1);
    expect(componentEvents[0].quantity).toBe("8.0000");
  });

  test("completion creates output stock and done status", async ({ db }) => {
    const completion = await completeManufacturingOrder(orderId, "4");
    expect(completion.status).toBe(200);

    const [productBalance] = await db
      .select({ onHandQty: inventoryItemBalances.onHandQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, productId));
    expect(productBalance.onHandQty).toBe("4.0000");

    const [order] = await db
      .select({ status: manufacturingOrders.status })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, orderId));
    expect(order.status).toBe("done");

    const outputEvents = await db
      .select({ quantity: inventoryEvents.quantity })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, productId),
          eq(inventoryEvents.eventType, "manufacturing_output")
        )
      );
    expect(outputEvents).toHaveLength(1);
    expect(outputEvents[0].quantity).toBe("4.0000");
  });

  test("output lot carries compact cost truth from consumed ingredients", async ({ db }) => {
    const [output] = await db
      .select({
        quantity: manufacturingOrderOutputs.quantity,
        unitCost: manufacturingOrderOutputs.unitCost,
        materialCostTotal: manufacturingOrderOutputs.materialCostTotal,
        lotId: manufacturingOrderOutputs.lotId,
      })
      .from(manufacturingOrderOutputs)
      .where(eq(manufacturingOrderOutputs.manufacturingOrderId, orderId));
    expect(output.quantity).toBe("4.0000");
    expect(output.unitCost).toBe("5.000000");
    expect(output.materialCostTotal).toBe("20.000000");

    const [lot] = await db
      .select({ unitCost: inventoryLotBalances.unitCost, quantity: lots.quantity })
      .from(lots)
      .innerJoin(inventoryLotBalances, eq(inventoryLotBalances.lotId, lots.id))
      .where(eq(lots.id, output.lotId));
    expect(lot).toMatchObject({
      quantity: "4.0000",
      unitCost: "5.000000",
    });

    const staleUpdate = await updateItem(componentId, {
      name: "Manufacturing Story Component Updated",
      defaultPurchasePrice: "4.00",
      stock: "12",
      bom: [],
    });
    expect(staleUpdate.status).toBe(200);

    const [unchangedOutput] = await db
      .select({ unitCost: manufacturingOrderOutputs.unitCost })
      .from(manufacturingOrderOutputs)
      .where(eq(manufacturingOrderOutputs.manufacturingOrderId, orderId));
    expect(unchangedOutput.unitCost).toBe("5.000000");
  });

  test("deleting a released order rolls back expected output", async ({ db }) => {
    const deleteComponent = await createMaterialFixture({
      name: "Manufacturing Delete Component",
      stock: "5",
      cost: "2.00",
    });
    const deleteProduct = await createSellableProductFixture({
      name: "Manufacturing Delete Product",
      stock: "0",
      price: "20.00",
      bom: [{ componentId: deleteComponent.id, quantity: "1" }],
    });
    const deleteOrderId = await createReleasedManufacturingOrder({
      productId: deleteProduct.id,
      componentId: deleteComponent.id,
      plannedQuantity: "2",
      quantityPerUnit: "1",
    });

    const [productBefore] = await db
      .select({ expectedQty: inventoryItemBalances.expectedQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, deleteProduct.id));
    expect(productBefore.expectedQty).toBe("2.0000");

    const deleteResponse = await testFetch(`/api/manufacturing-orders/${deleteOrderId}`, {
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(200);

    const [deletedOrder] = await db
      .select({ deletedAt: manufacturingOrders.deletedAt })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, deleteOrderId));
    expect(deletedOrder.deletedAt).toBeTruthy();

    const [productAfter] = await db
      .select({ expectedQty: inventoryItemBalances.expectedQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, deleteProduct.id));
    expect(productAfter.expectedQty).toBe("0.0000");

    const referencedEvents = await db
      .select({ eventType: inventoryEvents.eventType })
      .from(inventoryEvents)
      .where(eq(inventoryEvents.referenceId, deleteOrderId));
    expect(
      referencedEvents.filter((event) =>
        [
          "manufacturing_ingredient_consumption",
          "manufacturing_output",
          "unpick_restock",
        ].includes(event.eventType)
      )
    ).toHaveLength(0);
  });
});
