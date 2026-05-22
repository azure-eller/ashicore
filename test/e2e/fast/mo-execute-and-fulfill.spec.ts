import { and, eq, sql } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  inventoryEvents,
  lots,
  manufacturingOrderIngredients,
  manufacturingOrderOutputs,
  manufacturingOrders,
  manufacturingPickAllocations,
  salesShipments,
  salesShipmentLines,
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
} from "../../helpers/api";

test.describe("MO execute and fulfill — fast write-path smoke", () => {
  test("S08: discrete complete with unpicked ingredients returns 400 listing missing items", async ({
    db,
  }) => {
    const ts = Date.now();
    const unitId = getUnitId();

    const materialA = await createItem({
      name: `S08 Material A ${ts}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `S08-MAT-A-${ts}`,
      category: `S08 ${ts}`,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "100",
      safetyStock: "0",
      bom: [],
    });
    expect(materialA.status).toBe(201);

    const materialB = await createItem({
      name: `S08 Material B ${ts}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `S08-MAT-B-${ts}`,
      category: `S08 ${ts}`,
      description: null,
      defaultPurchasePrice: "3.00",
      defaultSellingPrice: null,
      stock: "100",
      safetyStock: "0",
      bom: [],
    });
    expect(materialB.status).toBe(201);

    const product = await createItem({
      name: `S08 Product ${ts}`,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `S08-PROD-${ts}`,
      category: `S08 ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "50.00",
      stock: "0",
      safetyStock: "0",
      bom: [
        { componentId: materialA.body.id, quantity: "1" },
        { componentId: materialB.body.id, quantity: "1" },
      ],
    });
    expect(product.status).toBe(201);

    const order = await createManufacturingOrder({
      productId: product.body.id,
      plannedQuantity: "10",
      ingredients: [
        { itemId: materialA.body.id, quantityPerUnit: "1" },
        { itemId: materialB.body.id, quantityPerUnit: "1" },
      ],
    });
    expect(order.status).toBe(201);
    const orderId = order.body.id as string;

    const release = await releaseManufacturingOrder(orderId);
    expect(release.status).toBe(200);

    const ingredients = await db
      .select({
        id: manufacturingOrderIngredients.id,
        itemId: manufacturingOrderIngredients.itemId,
        itemName: manufacturingOrderIngredients.itemName,
      })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, orderId));
    expect(ingredients).toHaveLength(2);

    // Pick only ingredient A; leave B unpicked.
    const ingredientA = ingredients.find(
      (row) => row.itemId === (materialA.body.id as string)
    );
    const ingredientB = ingredients.find(
      (row) => row.itemId === (materialB.body.id as string)
    );
    if (!ingredientA || !ingredientB) {
      throw new Error("Expected both ingredient rows");
    }

    const pickA = await testFetch(
      `/api/manufacturing-orders/${orderId}/ingredients/${ingredientA.id}/pick`,
      { method: "POST", body: JSON.stringify({}) }
    );
    expect(pickA.status).toBe(200);

    // Snapshot pre-complete state.
    const outputsBefore = await db
      .select({ id: manufacturingOrderOutputs.id })
      .from(manufacturingOrderOutputs)
      .where(eq(manufacturingOrderOutputs.manufacturingOrderId, orderId));
    expect(outputsBefore).toHaveLength(0);

    const productLotsBefore = await db
      .select({ id: lots.id })
      .from(lots)
      .where(eq(lots.itemId, product.body.id as string));
    expect(productLotsBefore).toHaveLength(0);

    // Attempt completion — should 400 on missing pick.
    const completeResponse = await testFetch(
      `/api/manufacturing-orders/${orderId}/complete`,
      {
        method: "POST",
        body: JSON.stringify({ actualQuantity: "10" }),
      }
    );
    expect(completeResponse.status).toBe(400);
    const completeBody = await completeResponse.json();
    expect(completeBody.error).toMatch(/Pick/i);
    expect(completeBody.error).toContain(ingredientB.itemName);

    // Order remains open with no completedAt.
    const [orderRow] = await db
      .select({
        status: manufacturingOrders.status,
        completedAt: manufacturingOrders.completedAt,
      })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, orderId));
    expect(orderRow.status).toBe("open");
    expect(orderRow.completedAt).toBeNull();

    // No manufacturing_output events for this MO.
    const outputEvents = await db
      .select({ id: inventoryEvents.id })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.referenceType, "manufacturing_order"),
          eq(inventoryEvents.referenceId, orderId),
          eq(inventoryEvents.eventType, "manufacturing_output")
        )
      );
    expect(outputEvents).toHaveLength(0);

    // No new lots for the product, no output rows.
    const productLotsAfter = await db
      .select({ id: lots.id })
      .from(lots)
      .where(eq(lots.itemId, product.body.id as string));
    expect(productLotsAfter).toHaveLength(0);

    const outputsAfter = await db
      .select({ id: manufacturingOrderOutputs.id })
      .from(manufacturingOrderOutputs)
      .where(eq(manufacturingOrderOutputs.manufacturingOrderId, orderId));
    expect(outputsAfter).toHaveLength(0);
  });

  test("S15: batch-mode MO rejects direct parent /complete with 400", async ({
    db,
  }) => {
    const ts = Date.now();
    const unitId = getUnitId();

    const material = await createItem({
      name: `S15 Material ${ts}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `S15-MAT-${ts}`,
      category: `S15 ${ts}`,
      description: null,
      defaultPurchasePrice: "1.00",
      defaultSellingPrice: null,
      stock: "200",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);

    const product = await createItem({
      name: `S15 Batch Product ${ts}`,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `S15-PROD-${ts}`,
      category: `S15 ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "10.00",
      stock: "0",
      safetyStock: "0",
      manufacturingMode: "batch",
      expectedBatchYield: "50",
      bom: [
        {
          componentId: material.body.id,
          quantity: "1",
        },
      ],
    });
    expect(product.status).toBe(201);

    const order = await createManufacturingOrder({
      productId: product.body.id,
      plannedQuantity: "50",
      ingredients: [{ itemId: material.body.id, quantityPerUnit: "1" }],
    });
    expect(order.status).toBe(201);
    const orderId = order.body.id as string;

    // Verify the order is batch-mode.
    const [createdOrder] = await db
      .select({
        manufacturingMode: manufacturingOrders.manufacturingMode,
        status: manufacturingOrders.status,
      })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, orderId));
    expect(createdOrder.manufacturingMode).toBe("batch");
    expect(createdOrder.status).toBe("open");

    // Attempt direct parent /complete — should 400.
    const completeResponse = await testFetch(
      `/api/manufacturing-orders/${orderId}/complete`,
      {
        method: "POST",
        body: JSON.stringify({ actualQuantity: "50" }),
      }
    );
    expect(completeResponse.status).toBe(400);
    const completeBody = await completeResponse.json();
    expect(completeBody.error).toMatch(/Batch-mode/i);

    // Order unchanged.
    const [orderAfter] = await db
      .select({
        status: manufacturingOrders.status,
        completedAt: manufacturingOrders.completedAt,
      })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, orderId));
    expect(orderAfter.status).toBe("open");
    expect(orderAfter.completedAt).toBeNull();

    const outputEvents = await db
      .select({ id: inventoryEvents.id })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.referenceType, "manufacturing_order"),
          eq(inventoryEvents.referenceId, orderId),
          eq(inventoryEvents.eventType, "manufacturing_output")
        )
      );
    expect(outputEvents).toHaveLength(0);

    const productLots = await db
      .select({ id: lots.id })
      .from(lots)
      .where(eq(lots.itemId, product.body.id as string));
    expect(productLots).toHaveLength(0);

    const outputRows = await db
      .select({ id: manufacturingOrderOutputs.id })
      .from(manufacturingOrderOutputs)
      .where(eq(manufacturingOrderOutputs.manufacturingOrderId, orderId));
    expect(outputRows).toHaveLength(0);
  });

  test("S16: pick on already-fully-picked ingredient returns 400 'is already picked'", async ({
    db,
  }) => {
    const ts = Date.now();
    const unitId = getUnitId();

    const material = await createItem({
      name: `S16 Material ${ts}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `S16-MAT-${ts}`,
      category: `S16 ${ts}`,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "100",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);

    const product = await createItem({
      name: `S16 Product ${ts}`,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `S16-PROD-${ts}`,
      category: `S16 ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "20.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: material.body.id, quantity: "1" }],
    });
    expect(product.status).toBe(201);

    const order = await createManufacturingOrder({
      productId: product.body.id,
      plannedQuantity: "10",
      ingredients: [{ itemId: material.body.id, quantityPerUnit: "1" }],
    });
    expect(order.status).toBe(201);
    const orderId = order.body.id as string;

    const release = await releaseManufacturingOrder(orderId);
    expect(release.status).toBe(200);

    const [ingredient] = await db
      .select({ id: manufacturingOrderIngredients.id })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, orderId));
    expect(ingredient).toBeDefined();

    const firstPick = await testFetch(
      `/api/manufacturing-orders/${orderId}/ingredients/${ingredient.id}/pick`,
      { method: "POST", body: JSON.stringify({}) }
    );
    expect(firstPick.status).toBe(200);

    const allocationsAfterFirst = await db
      .select({ id: manufacturingPickAllocations.id })
      .from(manufacturingPickAllocations)
      .where(
        eq(manufacturingPickAllocations.manufacturingOrderIngredientId, ingredient.id)
      );
    const allocationCountAfterFirst = allocationsAfterFirst.length;
    expect(allocationCountAfterFirst).toBeGreaterThan(0);

    const consumptionEventsAfterFirst = await db
      .select({ id: inventoryEvents.id })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.referenceType, "manufacturing_order"),
          eq(inventoryEvents.referenceId, orderId),
          eq(
            inventoryEvents.eventType,
            "manufacturing_ingredient_consumption"
          )
        )
      );
    const consumptionCountAfterFirst = consumptionEventsAfterFirst.length;

    // Force a distinct Idempotency-Key so the second call is NOT served from
    // the replay cache and actually hits the already-picked guard.
    const replayKey = `s16-retry-${ts}-${Math.random().toString(16).slice(2)}`;
    const secondPick = await testFetch(
      `/api/manufacturing-orders/${orderId}/ingredients/${ingredient.id}/pick`,
      {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "Idempotency-Key": replayKey },
      }
    );
    expect(secondPick.status).toBe(400);
    const secondBody = await secondPick.json();
    expect(secondBody.error).toMatch(/already picked/i);

    // No additional pick allocations.
    const allocationsAfterSecond = await db
      .select({ id: manufacturingPickAllocations.id })
      .from(manufacturingPickAllocations)
      .where(
        eq(manufacturingPickAllocations.manufacturingOrderIngredientId, ingredient.id)
      );
    expect(allocationsAfterSecond).toHaveLength(allocationCountAfterFirst);

    // No additional consumption events.
    const consumptionEventsAfterSecond = await db
      .select({ id: inventoryEvents.id })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.referenceType, "manufacturing_order"),
          eq(inventoryEvents.referenceId, orderId),
          eq(
            inventoryEvents.eventType,
            "manufacturing_ingredient_consumption"
          )
        )
      );
    expect(consumptionEventsAfterSecond).toHaveLength(consumptionCountAfterFirst);
  });

  test("S18: recordManufacturingOutput schema rejects quantity=0; accepts positive and negative", async ({
    db,
  }) => {
    const ts = Date.now();
    const unitId = getUnitId();

    const material = await createItem({
      name: `S18 Material ${ts}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `S18-MAT-${ts}`,
      category: `S18 ${ts}`,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "100",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);

    const product = await createItem({
      name: `S18 Product ${ts}`,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `S18-PROD-${ts}`,
      category: `S18 ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "25.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: material.body.id, quantity: "1" }],
    });
    expect(product.status).toBe(201);
    const productId = product.body.id as string;

    const order = await createManufacturingOrder({
      productId,
      plannedQuantity: "10",
      ingredients: [{ itemId: material.body.id, quantityPerUnit: "1" }],
    });
    expect(order.status).toBe(201);
    const orderId = order.body.id as string;

    const release = await releaseManufacturingOrder(orderId);
    expect(release.status).toBe(200);

    const [ingredient] = await db
      .select({ id: manufacturingOrderIngredients.id })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, orderId));
    expect(ingredient).toBeDefined();

    const pickResponse = await testFetch(
      `/api/manufacturing-orders/${orderId}/ingredients/${ingredient.id}/pick`,
      { method: "POST", body: JSON.stringify({}) }
    );
    expect(pickResponse.status).toBe(200);

    // Call 1: quantity '0' — schema-level 400.
    const zeroResponse = await testFetch(
      `/api/manufacturing-orders/${orderId}/outputs`,
      {
        method: "POST",
        body: JSON.stringify({
          quantity: "0",
          outputDisposition: "available",
        }),
      }
    );
    expect(zeroResponse.status).toBe(400);

    // No output rows, no events, no lots after the 0 call.
    const outputsAfterZero = await db
      .select({ id: manufacturingOrderOutputs.id })
      .from(manufacturingOrderOutputs)
      .where(eq(manufacturingOrderOutputs.manufacturingOrderId, orderId));
    expect(outputsAfterZero).toHaveLength(0);

    const eventsAfterZero = await db
      .select({ id: inventoryEvents.id })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.referenceType, "manufacturing_order"),
          eq(inventoryEvents.referenceId, orderId),
          eq(inventoryEvents.eventType, "manufacturing_output")
        )
      );
    expect(eventsAfterZero).toHaveLength(0);

    const lotsAfterZero = await db
      .select({ id: lots.id })
      .from(lots)
      .where(eq(lots.itemId, productId));
    expect(lotsAfterZero).toHaveLength(0);

    // Call 2: positive '5' — 200.
    const positiveResponse = await testFetch(
      `/api/manufacturing-orders/${orderId}/outputs`,
      {
        method: "POST",
        body: JSON.stringify({
          quantity: "5",
          outputDisposition: "available",
        }),
      }
    );
    expect(positiveResponse.status).toBe(200);

    const outputsAfterPositive = await db
      .select({
        id: manufacturingOrderOutputs.id,
        quantity: manufacturingOrderOutputs.quantity,
      })
      .from(manufacturingOrderOutputs)
      .where(eq(manufacturingOrderOutputs.manufacturingOrderId, orderId));
    expect(outputsAfterPositive).toHaveLength(1);
    expect(parseFloat(outputsAfterPositive[0].quantity)).toBe(5);

    // Call 3: negative '-3' — 200 (reversal path).
    const negativeResponse = await testFetch(
      `/api/manufacturing-orders/${orderId}/outputs`,
      {
        method: "POST",
        body: JSON.stringify({
          quantity: "-3",
          outputDisposition: "available",
        }),
      }
    );
    expect(negativeResponse.status).toBe(200);

    const outputsAfterNegative = await db
      .select({
        id: manufacturingOrderOutputs.id,
        quantity: manufacturingOrderOutputs.quantity,
      })
      .from(manufacturingOrderOutputs)
      .where(eq(manufacturingOrderOutputs.manufacturingOrderId, orderId));
    expect(outputsAfterNegative).toHaveLength(2);
    const totals = outputsAfterNegative.map((row) => parseFloat(row.quantity)).sort(
      (a, b) => a - b
    );
    expect(totals).toEqual([-3, 5]);
  });

  test("S23: pick 409 stock_shortage first attempt (no override)", async ({ db }) => {
    const ts = Date.now();
    const unitId = getUnitId();

    const material = await createItem({
      name: `S23 Material ${ts}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `S23-MAT-${ts}`,
      category: `S23 ${ts}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "5",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);
    const materialId = material.body.id as string;

    const product = await createItem({
      name: `S23 Product ${ts}`,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `S23-PROD-${ts}`,
      category: `S23 ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "30.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: materialId, quantity: "1" }],
    });
    expect(product.status).toBe(201);

    const order = await createManufacturingOrder({
      productId: product.body.id,
      plannedQuantity: "10",
      ingredients: [{ itemId: materialId, quantityPerUnit: "1" }],
      confirmShortage: true,
    });
    expect(order.status).toBe(201);
    const orderId = order.body.id as string;

    const release = await releaseManufacturingOrder(orderId, {
      confirmShortage: true,
    });
    expect(release.status).toBe(200);

    const [ingredient] = await db
      .select({ id: manufacturingOrderIngredients.id })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, orderId));
    expect(ingredient).toBeDefined();

    const allocationsBefore = await db
      .select({ id: manufacturingPickAllocations.id })
      .from(manufacturingPickAllocations)
      .where(
        eq(manufacturingPickAllocations.manufacturingOrderIngredientId, ingredient.id)
      );
    expect(allocationsBefore).toHaveLength(0);

    const pickResponse = await testFetch(
      `/api/manufacturing-orders/${orderId}/ingredients/${ingredient.id}/pick`,
      { method: "POST", body: JSON.stringify({}) }
    );
    expect(pickResponse.status).toBe(409);
    const pickBody = await pickResponse.json();
    expect(pickBody).toMatchObject({
      shortage: {
        ingredients: [
          expect.objectContaining({
            itemId: materialId,
            itemName: expect.stringContaining(`S23 Material ${ts}`),
            warningType: "stock_shortage",
          }),
        ],
      },
    });

    // No new pick allocations.
    const allocationsAfter = await db
      .select({ id: manufacturingPickAllocations.id })
      .from(manufacturingPickAllocations)
      .where(
        eq(manufacturingPickAllocations.manufacturingOrderIngredientId, ingredient.id)
      );
    expect(allocationsAfter).toHaveLength(0);

    // pickStatus unchanged.
    const [ingredientRow] = await db
      .select({ pickStatus: manufacturingOrderIngredients.pickStatus })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.id, ingredient.id));
    expect(ingredientRow.pickStatus).toBe("not_picked");

    // No consumption events for this MO.
    const consumptionEvents = await db
      .select({ id: inventoryEvents.id })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.referenceType, "manufacturing_order"),
          eq(inventoryEvents.referenceId, orderId),
          eq(
            inventoryEvents.eventType,
            "manufacturing_ingredient_consumption"
          )
        )
      );
    expect(consumptionEvents).toHaveLength(0);

    // No NEG lot created for the under-stocked material.
    const negLots = await db
      .select({ id: lots.id })
      .from(lots)
      .where(
        and(
          eq(lots.itemId, materialId),
          sql`${lots.lotNumber} LIKE 'NEG-%'`
        )
      );
    expect(negLots).toHaveLength(0);
  });

  test("S24: ship 409 negativeStock first attempt (no override)", async ({ db }) => {
    const ts = Date.now();
    const unitId = getUnitId();

    const customer = await createCustomer({
      name: `S24 Customer ${ts}`,
    });
    expect(customer.status).toBe(201);

    const material = await createItem({
      name: `S24 Material ${ts}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `S24-MAT-${ts}`,
      category: `S24 ${ts}`,
      description: null,
      defaultPurchasePrice: "5.00",
      defaultSellingPrice: null,
      stock: "100",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);

    // Product is sellable, has an active BOM (so cost-walk can resolve), but
    // currently zero stock — so the ship attempt hits negative stock before
    // any cost-basis issue.
    const product = await createItem({
      name: `S24 Product ${ts}`,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `S24-PROD-${ts}`,
      category: `S24 ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "20.00",
      sellable: true,
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: material.body.id, quantity: "1" }],
    });
    expect(product.status).toBe(201);
    const productId = product.body.id as string;

    const orderDate = new Date().toISOString().slice(0, 10);
    const orderResult = await createSalesOrder({
      customerId: customer.body.id,
      status: "open",
      orderDate,
      shipDate: orderDate,
      requestedDate: orderDate,
      confirmOversell: true,
      lines: [{ itemId: productId, quantity: "10", unitPrice: "20.00" }],
      shipments: [
        {
          fulfillmentType: "delivery",
          scheduledDate: orderDate,
          deliveryDate: orderDate,
          lines: [{ itemId: productId, quantity: "10" }],
        },
      ],
    });
    expect(orderResult.status).toBe(201);
    const orderId = orderResult.body.id as string;

    const confirmResult = await confirmSalesOrder(orderId, {
      confirmOversell: true,
    });
    expect(confirmResult.status).toBe(200);

    const [shipment] = await db
      .select({
        id: salesShipments.id,
        status: salesShipments.status,
        shippedAt: salesShipments.shippedAt,
      })
      .from(salesShipments)
      .where(eq(salesShipments.salesOrderId, orderId));
    expect(shipment).toBeDefined();
    expect(shipment.status).toBe("planned");
    const shipmentId = shipment.id;

    const [shipmentLine] = await db
      .select({ id: salesShipmentLines.id })
      .from(salesShipmentLines)
      .where(eq(salesShipmentLines.salesShipmentId, shipmentId));
    expect(shipmentLine).toBeDefined();

    const eventsBefore = await db
      .select({ id: inventoryEvents.id })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.referenceType, "sales_shipment"),
          eq(inventoryEvents.referenceId, shipmentId)
        )
      );
    expect(eventsBefore).toHaveLength(0);

    const shipResponse = await testFetch(
      `/api/sales-orders/${orderId}/shipments/${shipmentId}/ship`,
      {
        method: "POST",
        body: JSON.stringify({ syncAccounting: false }),
      }
    );
    expect(shipResponse.status).toBe(409);
    const shipBody = await shipResponse.json();
    expect(shipBody.negativeStock).toBeDefined();
    expect(shipBody.negativeStock).toEqual(
      expect.objectContaining({
        itemId: productId,
      })
    );
    // Spot-check the documented shape — itemName, available, requested, shortage.
    expect(shipBody.negativeStock.itemName).toBeTruthy();
    expect(shipBody.negativeStock.available).toBeDefined();
    expect(shipBody.negativeStock.requested).toBeDefined();
    expect(shipBody.negativeStock.shortage).toBeDefined();

    // Shipment unchanged.
    const [shipmentAfter] = await db
      .select({
        status: salesShipments.status,
        shippedAt: salesShipments.shippedAt,
      })
      .from(salesShipments)
      .where(eq(salesShipments.id, shipmentId));
    expect(shipmentAfter.status).toBe("planned");
    expect(shipmentAfter.shippedAt).toBeNull();

    // No inventory events for this shipment.
    const eventsAfter = await db
      .select({ id: inventoryEvents.id })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.referenceType, "sales_shipment"),
          eq(inventoryEvents.referenceId, shipmentId)
        )
      );
    expect(eventsAfter).toHaveLength(0);

    // No NEG-prefixed lot for the product.
    const negLots = await db
      .select({ id: lots.id })
      .from(lots)
      .where(
        and(
          eq(lots.itemId, productId),
          sql`${lots.lotNumber} LIKE 'NEG-%'`
        )
      );
    expect(negLots).toHaveLength(0);
  });
});

