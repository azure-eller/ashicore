import { and, eq } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  inventoryDemandSummary,
  inventoryEvents,
  inventoryItemBalances,
  lots,
  manufacturingOrderBatches,
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

  test("batch order completion lots each batch into its own produced lot", async ({
    db,
  }) => {
    const component = await createItem({
      itemType: "material",
      name: `Fast MO Batch Component ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-MO-BATCH-COMP-${ts}`,
      category: `Fast Manufacturing ${ts}`,
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
      name: `Fast MO Batch Product ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-MO-BATCH-PRODUCT-${ts}`,
      category: `Fast Manufacturing ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "20.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: component.body.id, quantity: "1" }],
    });
    expect(product.status).toBe(201);

    const batchRevision = await testFetch(
      `/api/items/${product.body.id}/bom-revisions`,
      {
        method: "POST",
        body: JSON.stringify({
          recipeBasis: "batch",
          expectedBatchYield: "10",
          outputQuantity: "10",
          bom: [{ componentId: component.body.id, quantity: "1" }],
        }),
      }
    );
    expect([200, 201]).toContain(batchRevision.status);

    const order = await createManufacturingOrder({
      productId: product.body.id,
      plannedQuantity: "20", // 2 batches of 10
      ingredients: [{ itemId: component.body.id, quantityPerUnit: "1" }],
      confirmShortage: false,
    });
    expect(order.status).toBe(201);
    expect((await releaseManufacturingOrder(order.body.id)).status).toBe(200);
    const orderId = order.body.id as string;

    async function currentBatchId() {
      const execution = await testFetch(
        `/api/manufacturing-orders/${orderId}/execution`
      );
      expect(execution.status).toBe(200);
      const body = await execution.json();
      const batch =
        body.currentBatch ??
        body.batches.find((b: { status: string }) => b.status !== "completed");
      return batch.id as string;
    }

    // Each batch records and completes on its own — the field workflow where the
    // first batch must not swallow the second batch's output.
    const batch1 = await currentBatchId();
    const batch1Output = await testFetch(
      `/api/manufacturing-orders/${orderId}/batches/${batch1}/outputs`,
      {
        method: "POST",
        body: JSON.stringify({ quantity: "10", producedLotNumber: "BATCH-A" }),
      }
    );
    expect(batch1Output.status).toBe(200);
    const batch1Complete = await testFetch(
      `/api/manufacturing-orders/${orderId}/batches/${batch1}/complete`,
      { method: "POST", body: JSON.stringify({}) }
    );
    expect(batch1Complete.status).toBe(200);

    const batch2 = await currentBatchId();
    const batch2Output = await testFetch(
      `/api/manufacturing-orders/${orderId}/batches/${batch2}/outputs`,
      { method: "POST", body: JSON.stringify({ quantity: "10" }) }
    );
    expect(batch2Output.status).toBe(200);
    const batch2Complete = await testFetch(
      `/api/manufacturing-orders/${orderId}/batches/${batch2}/complete`,
      { method: "POST", body: JSON.stringify({}) }
    );
    expect(batch2Complete.status).toBe(200);

    const batches = await db
      .select({
        id: manufacturingOrderBatches.id,
        lotId: manufacturingOrderBatches.lotId,
      })
      .from(manufacturingOrderBatches)
      .where(eq(manufacturingOrderBatches.manufacturingOrderId, orderId));
    expect(batches).toHaveLength(2);
    expect(new Set(batches.map((b) => b.lotId)).size).toBe(2);

    const [namedBatch] = await db
      .select({ lotNumber: lots.lotNumber, quantity: lots.quantity })
      .from(lots)
      .innerJoin(manufacturingOrderBatches, eq(manufacturingOrderBatches.lotId, lots.id))
      .where(eq(manufacturingOrderBatches.id, batch1));
    expect(namedBatch.lotNumber).toBe("BATCH-A");
    expect(namedBatch.quantity).toBe("10.0000");

    const [savedOrder] = await db
      .select({ status: manufacturingOrders.status })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, orderId));
    expect(savedOrder.status).toBe("done");
  });

  test("started open order blocks planning edits but allows rescheduling", async ({
    db,
  }) => {
    const fixture = await createBomFixture("StartedEditGuard");
    const order = await createManufacturingOrder({
      productId: fixture.productId,
      plannedQuantity: "2",
      plannedDate: "2026-06-10",
      ingredients: [{ itemId: fixture.componentId, quantityPerUnit: "2" }],
    });
    expect(order.status).toBe(201);

    const start = await testFetch(`/api/manufacturing-orders/${order.body.id}/start`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(start.status).toBe(200);

    const datePatch = await testFetch(`/api/manufacturing-orders/${order.body.id}`, {
      method: "PATCH",
      body: JSON.stringify({ plannedDate: "2026-06-15" }),
    });
    expect(datePatch.status).toBe(200);

    const quantityEdit = await testFetch(`/api/manufacturing-orders/${order.body.id}`, {
      method: "PUT",
      body: JSON.stringify({
        productId: fixture.productId,
        plannedQuantity: "3",
        plannedDate: "2026-06-20",
        notes: null,
        ingredients: [{ itemId: fixture.componentId, quantityPerUnit: "2" }],
        lotAllocations: [],
      }),
    });
    const quantityEditBody = await quantityEdit.json().catch(() => null);
    expect(quantityEdit.status).toBe(400);
    expect(quantityEditBody?.error).toContain("Manufacturing work has started");

    const [saved] = await db
      .select({
        plannedQuantity: manufacturingOrders.plannedQuantity,
        plannedDate: manufacturingOrders.plannedDate,
      })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, order.body.id));

    expect(saved.plannedQuantity).toBe("2.0000");
    expect(saved.plannedDate).toBe("2026-06-15");
  });
});
