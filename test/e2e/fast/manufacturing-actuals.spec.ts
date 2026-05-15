import { and, eq, sql } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  inventoryEvents,
  inventoryItemBalances,
  inventoryLotBalances,
  manufacturingOrderBatches,
  manufacturingOrderIngredients,
  manufacturingOrders,
  manufacturingPickAllocations,
} from "../../../lib/db/schema";
import { createItem, getUnitId, testFetch } from "../../helpers/api";

async function expectManufacturingOrderOpen(orderId: string) {
  const response = await testFetch(`/api/manufacturing-orders/${orderId}`);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.status).toBe("open");
}

test.describe("Manufacturing batch ingredient actuals", () => {
  test.describe.configure({ mode: "serial" });

  test("captures over- and under-consumption variance at batch completion", async ({
    db,
  }) => {
    test.slow();

    const ts = Date.now();
    const unitId = getUnitId();
    const soilName = `Actuals Soil ${ts}`;
    const productName = `Actuals Bag ${ts}`;

    const soilCreate = await createItem({
      name: soilName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `ACTUALS-SOIL-${ts}`,
      category: `Actuals ${ts}`,
      description: "Soil tote for actuals test",
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "200",
      safetyStock: "0",
      bom: [],
    });
    expect(soilCreate.status).toBe(201);
    const soilId = soilCreate.body.id as string;

    const productCreate = await createItem({
      name: productName,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `ACTUALS-PRODUCT-${ts}`,
      category: `Actuals ${ts}`,
      description: "Bulk bag product for actuals test",
      defaultPurchasePrice: null,
      defaultSellingPrice: "50.00",
      stock: "0",
      safetyStock: "0",
      manufacturingMode: "batch",
      expectedBatchYield: "50",
      bom: [{ componentId: soilId, quantity: "1" }],
    });
    expect(productCreate.status).toBe(201);
    const productId = productCreate.body.id as string;

    const createResponse = await testFetch("/api/manufacturing-orders", {
      method: "POST",
      body: JSON.stringify({
        productId,
        plannedQuantity: "100",
        plannedDate: null,
        notes: "Actuals smoke test",
        ingredients: [{ itemId: soilId, quantityPerUnit: "1" }],
      }),
    });
    expect(createResponse.status).toBe(201);
    const orderId = (await createResponse.json()).id as string;

    await expectManufacturingOrderOpen(orderId);

    const batches = await db
      .select()
      .from(manufacturingOrderBatches)
      .where(eq(manufacturingOrderBatches.manufacturingOrderId, orderId));
    expect(batches).toHaveLength(2);
    const sortedBatches = [...batches].sort(
      (left, right) => left.batchNumber - right.batchNumber
    );
    const [batchOne, batchTwo] = sortedBatches;

    const getBatchIngredient = async (batchId: string) => {
      const [ingredient] = await db
        .select()
        .from(manufacturingOrderIngredients)
        .where(
          and(
            eq(manufacturingOrderIngredients.manufacturingOrderId, orderId),
            eq(manufacturingOrderIngredients.manufacturingOrderBatchId, batchId)
          )
        );
      expect(ingredient).toBeDefined();
      return ingredient!;
    };

    // Batch 1: under-consume — plan 1, pick 1, actual 0.98
    const batchOneIngredient = await getBatchIngredient(batchOne.id);

    const startOneResponse = await testFetch(
      `/api/manufacturing-orders/${orderId}/batches/${batchOne.id}/start`,
      { method: "POST" }
    );
    expect(startOneResponse.status).toBe(200);

    const pickOneResponse = await testFetch(
      `/api/manufacturing-orders/${orderId}/ingredients/${batchOneIngredient.id}/pick`,
      { method: "POST" }
    );
    expect(pickOneResponse.status).toBe(200);

    const completeOneResponse = await testFetch(
      `/api/manufacturing-orders/${orderId}/batches/${batchOne.id}/complete`,
      {
        method: "POST",
        body: JSON.stringify({
          actualQuantity: "50",
          ingredientActuals: [
            { ingredientId: batchOneIngredient.id, actualConsumedQuantity: "0.98" },
          ],
        }),
      }
    );
    expect(completeOneResponse.status).toBe(200);

    const [reconciledOne] = await db
      .select()
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.id, batchOneIngredient.id));
    expect(reconciledOne.actualQuantity).toBe("0.9800");

    const varianceGainEvents = await db
      .select()
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.referenceType, "manufacturing_batch"),
          eq(inventoryEvents.referenceId, batchOne.id),
          eq(inventoryEvents.eventType, "manufacturing_variance_gain")
        )
      );
    expect(varianceGainEvents).toHaveLength(1);
    expect(varianceGainEvents[0].quantity).toBe("0.0200");
    expect(varianceGainEvents[0].itemId).toBe(soilId);

    // Batch 2: over-consume — plan 1, pick 1, actual 1.02
    const batchTwoIngredient = await getBatchIngredient(batchTwo.id);

    const startTwoResponse = await testFetch(
      `/api/manufacturing-orders/${orderId}/batches/${batchTwo.id}/start`,
      { method: "POST" }
    );
    expect(startTwoResponse.status).toBe(200);

    const pickTwoResponse = await testFetch(
      `/api/manufacturing-orders/${orderId}/ingredients/${batchTwoIngredient.id}/pick`,
      { method: "POST" }
    );
    expect(pickTwoResponse.status).toBe(200);

    const completeTwoResponse = await testFetch(
      `/api/manufacturing-orders/${orderId}/batches/${batchTwo.id}/complete`,
      {
        method: "POST",
        body: JSON.stringify({
          actualQuantity: "50",
          ingredientActuals: [
            { ingredientId: batchTwoIngredient.id, actualConsumedQuantity: "1.02" },
          ],
        }),
      }
    );
    expect(completeTwoResponse.status).toBe(200);

    const [reconciledTwo] = await db
      .select()
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.id, batchTwoIngredient.id));
    expect(reconciledTwo.actualQuantity).toBe("1.0200");

    const varianceLossEvents = await db
      .select()
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.referenceType, "manufacturing_batch"),
          eq(inventoryEvents.referenceId, batchTwo.id),
          eq(inventoryEvents.eventType, "manufacturing_variance_loss")
        )
      );
    expect(varianceLossEvents).toHaveLength(1);
    expect(varianceLossEvents[0].quantity).toBe("0.0200");
    expect(varianceLossEvents[0].itemId).toBe(soilId);

    const [completedOrder] = await db
      .select({
        status: manufacturingOrders.status,
        actualQuantity: manufacturingOrders.actualQuantity,
      })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, orderId));
    expect(completedOrder.status).toBe("done");
    expect(completedOrder.actualQuantity).toBe("100.0000");

    const [remainingSoil] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, soilId));
    // Started with 200 totes, total net consumption = 0.98 + 1.02 = 2
    expect(parseFloat(remainingSoil.onHandQty)).toBeCloseTo(198, 4);

    const allocations = await db
      .select({
        totalUsed: sql<string>`COALESCE(SUM(${manufacturingPickAllocations.quantityUsed}), 0)`,
      })
      .from(manufacturingPickAllocations)
      .innerJoin(
        manufacturingOrderIngredients,
        eq(
          manufacturingPickAllocations.manufacturingOrderIngredientId,
          manufacturingOrderIngredients.id
        )
      )
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, orderId));
    // Net across both batches: 0.98 + 1.02 = 2 totes still allocated
    expect(parseFloat(allocations[0].totalUsed)).toBeCloseTo(2, 4);

    const soilLotBalances = await db
      .select({ quantity: inventoryLotBalances.quantity })
      .from(inventoryLotBalances)
      .where(eq(inventoryLotBalances.itemId, soilId));
    const lotTotal = soilLotBalances.reduce(
      (sum, row) => sum + parseFloat(row.quantity),
      0
    );
    expect(lotTotal).toBeCloseTo(198, 4);
  });

  test("returns 409 when discrete actuals exceed remaining stock", async ({
    db,
  }) => {
    const ts = Date.now();
    const unitId = getUnitId();
    const soilName = `Actuals Discrete Soil ${ts}`;
    const productName = `Actuals Discrete Product ${ts}`;

    const soilCreate = await createItem({
      name: soilName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `ACTUALS-DISCRETE-SOIL-${ts}`,
      category: `Actuals Discrete ${ts}`,
      description: "Soil for discrete actuals shortage",
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "51",
      safetyStock: "0",
      bom: [],
    });
    expect(soilCreate.status).toBe(201);
    const soilId = soilCreate.body.id as string;

    const productCreate = await createItem({
      name: productName,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `ACTUALS-DISCRETE-PRODUCT-${ts}`,
      category: `Actuals Discrete ${ts}`,
      description: "Discrete product for actuals shortage",
      defaultPurchasePrice: null,
      defaultSellingPrice: "50.00",
      stock: "0",
      safetyStock: "0",
      manufacturingMode: "discrete",
      expectedBatchYield: null,
      bom: [{ componentId: soilId, quantity: "1" }],
    });
    expect(productCreate.status).toBe(201);
    const productId = productCreate.body.id as string;

    const createResponse = await testFetch("/api/manufacturing-orders", {
      method: "POST",
      body: JSON.stringify({
        productId,
        plannedQuantity: "50",
        plannedDate: null,
        notes: "Discrete actuals shortage test",
        ingredients: [{ itemId: soilId, quantityPerUnit: "1" }],
      }),
    });
    expect(createResponse.status).toBe(201);
    const orderId = (await createResponse.json()).id as string;

    await expectManufacturingOrderOpen(orderId);

    const [ingredient] = await db
      .select()
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, orderId));
    expect(ingredient).toBeDefined();

    const pickResponse = await testFetch(
      `/api/manufacturing-orders/${orderId}/ingredients/${ingredient!.id}/pick`,
      { method: "POST" }
    );
    expect(pickResponse.status).toBe(200);

    const completeResponse = await testFetch(
      `/api/manufacturing-orders/${orderId}/complete`,
      {
        method: "POST",
        body: JSON.stringify({
          actualQuantity: "50",
          ingredientActuals: [
            { ingredientId: ingredient!.id, actualConsumedQuantity: "52" },
          ],
        }),
      }
    );
    expect(completeResponse.status).toBe(409);
    const completeBody = await completeResponse.json();
    expect(completeBody).toMatchObject({
      error: expect.stringContaining("Insufficient stock"),
    });

    const [order] = await db
      .select({
        status: manufacturingOrders.status,
        actualQuantity: manufacturingOrders.actualQuantity,
      })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, orderId));
    expect(order.status).toBe("open");
    expect(order.actualQuantity).toBeNull();
  });

  test("returns 409 when batch actuals exceed remaining stock", async ({
    db,
  }) => {
    const ts = Date.now();
    const unitId = getUnitId();
    const soilName = `Actuals Batch Soil ${ts}`;
    const productName = `Actuals Batch Product ${ts}`;

    const soilCreate = await createItem({
      name: soilName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `ACTUALS-BATCH-SOIL-${ts}`,
      category: `Actuals Batch ${ts}`,
      description: "Soil for batch actuals shortage",
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "51",
      safetyStock: "0",
      bom: [],
    });
    expect(soilCreate.status).toBe(201);
    const soilId = soilCreate.body.id as string;

    const productCreate = await createItem({
      name: productName,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `ACTUALS-BATCH-PRODUCT-${ts}`,
      category: `Actuals Batch ${ts}`,
      description: "Batch product for actuals shortage",
      defaultPurchasePrice: null,
      defaultSellingPrice: "50.00",
      stock: "0",
      safetyStock: "0",
      manufacturingMode: "batch",
      expectedBatchYield: "50",
      bom: [{ componentId: soilId, quantity: "1" }],
    });
    expect(productCreate.status).toBe(201);
    const productId = productCreate.body.id as string;

    const createResponse = await testFetch("/api/manufacturing-orders", {
      method: "POST",
      body: JSON.stringify({
        productId,
        plannedQuantity: "50",
        plannedDate: null,
        notes: "Batch actuals shortage test",
        ingredients: [{ itemId: soilId, quantityPerUnit: "1" }],
      }),
    });
    expect(createResponse.status).toBe(201);
    const orderId = (await createResponse.json()).id as string;

    await expectManufacturingOrderOpen(orderId);

    const [batch] = await db
      .select()
      .from(manufacturingOrderBatches)
      .where(eq(manufacturingOrderBatches.manufacturingOrderId, orderId));
    expect(batch).toBeDefined();

    const [ingredient] = await db
      .select()
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderBatchId, batch!.id));
    expect(ingredient).toBeDefined();

    const startResponse = await testFetch(
      `/api/manufacturing-orders/${orderId}/batches/${batch!.id}/start`,
      { method: "POST" }
    );
    expect(startResponse.status).toBe(200);

    const pickResponse = await testFetch(
      `/api/manufacturing-orders/${orderId}/ingredients/${ingredient!.id}/pick`,
      { method: "POST" }
    );
    expect(pickResponse.status).toBe(200);

    const completeResponse = await testFetch(
      `/api/manufacturing-orders/${orderId}/batches/${batch!.id}/complete`,
      {
        method: "POST",
        body: JSON.stringify({
          actualQuantity: "50",
          ingredientActuals: [
            { ingredientId: ingredient!.id, actualConsumedQuantity: "52" },
          ],
        }),
      }
    );
    expect(completeResponse.status).toBe(409);
    const completeBody = await completeResponse.json();
    expect(completeBody).toMatchObject({
      error: expect.stringContaining("Insufficient stock"),
    });

    const [batchRow] = await db
      .select({
        status: manufacturingOrderBatches.status,
        actualQuantity: manufacturingOrderBatches.actualQuantity,
      })
      .from(manufacturingOrderBatches)
      .where(eq(manufacturingOrderBatches.id, batch!.id));
    expect(batchRow.status).toBe("in_progress");
    expect(batchRow.actualQuantity).toBeNull();
  });
});
