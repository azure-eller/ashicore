import fs from "node:fs/promises";
import path from "node:path";
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
  notifications,
  user,
} from "../../../lib/db/schema";
import {
  completeManufacturingOrder,
  createItem,
  createManufacturingOrder,
  getUnitId,
  releaseManufacturingOrder,
  testFetch,
} from "../../helpers/api";

const FCM_OUTBOX_DIR = path.join(process.cwd(), ".tmp", "fcm-outbox");

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

  async function setNotificationPreference(eventType: string, enabled: boolean) {
    const res = await testFetch("/api/notification-preferences", {
      method: "PUT",
      body: JSON.stringify({
        eventType,
        enabled,
      }),
    });
    expect(res.status).toBe(200);
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

  test("ingredient pick warns before taking stock covered by earlier demand", async ({
    db,
  }) => {
    const fixture = await createBomFixture("Queue Pick");
    const earlierOrder = await createManufacturingOrder({
      productId: fixture.productId,
      plannedQuantity: "5",
      ingredients: [{ itemId: fixture.componentId, quantityPerUnit: "2" }],
      confirmShortage: false,
    });
    expect(earlierOrder.status, JSON.stringify(earlierOrder.body)).toBe(201);
    const laterOrder = await createManufacturingOrder({
      productId: fixture.productId,
      plannedQuantity: "5",
      ingredients: [{ itemId: fixture.componentId, quantityPerUnit: "2" }],
      confirmShortage: false,
    });
    expect(laterOrder.status, JSON.stringify(laterOrder.body)).toBe(201);

    const reorder = await testFetch("/api/manufacturing-orders/priority-ranks", {
      method: "PATCH",
      body: JSON.stringify({
        orderIds: [earlierOrder.body.id, laterOrder.body.id],
      }),
    });
    expect(reorder.status, await reorder.text()).toBe(200);
    expect((await releaseManufacturingOrder(earlierOrder.body.id)).status).toBe(200);
    expect(
      (await releaseManufacturingOrder(laterOrder.body.id, { confirmShortage: true }))
        .status
    ).toBe(200);

    const [laterIngredient] = await db
      .select({ id: manufacturingOrderIngredients.id })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, laterOrder.body.id));
    const firstPick = await testFetch(
      `/api/manufacturing-orders/${laterOrder.body.id}/ingredients/${laterIngredient.id}/pick`,
      {
        method: "POST",
        body: JSON.stringify({ confirmNegativeStock: false }),
      }
    );
    const firstPickBody = await firstPick.json();
    expect(firstPick.status, JSON.stringify(firstPickBody)).toBe(409);
    expect(firstPickBody?.shortage?.ingredients?.[0]).toMatchObject({
      itemId: fixture.componentId,
      available: 0,
      needed: 10,
      shortage: 10,
      warningType: "queue_conflict",
    });

    const confirmedPick = await testFetch(
      `/api/manufacturing-orders/${laterOrder.body.id}/ingredients/${laterIngredient.id}/pick`,
      {
        method: "POST",
        body: JSON.stringify({ confirmNegativeStock: true }),
      }
    );
    expect(confirmedPick.status, await confirmedPick.text()).toBe(200);
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
      {
        method: "POST",
        body: JSON.stringify({
          actualQuantity: null,
          outputDisposition: "available",
          ingredientActuals: [],
          confirmNegativeStock: false,
        }),
      }
    );
    expect(batch1Complete.status).toBe(200);

    const batch2 = await currentBatchId();
    const batch2Output = await testFetch(
      `/api/manufacturing-orders/${orderId}/batches/${batch2}/outputs`,
      { method: "POST", body: JSON.stringify({ quantity: "10" }) }
    );
    expect(batch2Output.status).toBe(200);
    await setNotificationPreference("manufacturing_order_completed", true);
    try {
      const batch2Complete = await testFetch(
        `/api/manufacturing-orders/${orderId}/batches/${batch2}/complete`,
        { method: "POST", body: JSON.stringify({}) }
      );
      expect(batch2Complete.status).toBe(200);
    } finally {
      await setNotificationPreference("manufacturing_order_completed", false);
    }

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

    const [batchDoneNotification] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.entityId, orderId),
          eq(notifications.type, "manufacturing_order_completed")
        )
      );
    expect(batchDoneNotification).toBeTruthy();
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

  test("MO lifecycle fans out notifications to subscribed users only", async ({
    db,
  }) => {
    const fixture = await createBomFixture("Notif Fanout");

    async function createOrder() {
      const order = await createManufacturingOrder({
        productId: fixture.productId,
        plannedQuantity: "3",
        ingredients: [{ itemId: fixture.componentId, quantityPerUnit: "2" }],
        confirmShortage: false,
      });
      expect(order.status).toBe(201);
      return order.body.id as string;
    }

    try {
      // Not subscribed -> no rows.
      await setNotificationPreference("manufacturing_order_created", false);
      await setNotificationPreference("manufacturing_order_completed", false);
      const silentOrderId = await createOrder();
      const silentRows = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(eq(notifications.entityId, silentOrderId));
      expect(silentRows).toHaveLength(0);

      // Subscribed with a device -> row delivered + push in outbox.
      await setNotificationPreference("manufacturing_order_created", true);
      await setNotificationPreference("manufacturing_order_completed", true);
      const token = `fast-fanout-${ts}`;
      const deviceRes = await testFetch("/api/push-devices", {
        method: "POST",
        body: JSON.stringify({ token, platform: "android" }),
      });
      expect(deviceRes.status).toBe(200);

      const orderId = await createOrder();
      const [testUser] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, "test@test.com"));
      const rows = await db
        .select({
          id: notifications.id,
          deliveryStatus: notifications.deliveryStatus,
        })
        .from(notifications)
        .where(
          and(
            eq(notifications.entityId, orderId),
            eq(notifications.type, "manufacturing_order_created"),
            eq(notifications.userId, testUser.id)
          )
        );
      expect(rows).toHaveLength(1);
      expect(rows[0].deliveryStatus).toBe("delivered");

      const files = await fs.readdir(FCM_OUTBOX_DIR);
      const payloads = await Promise.all(
        files.map((f) =>
          fs.readFile(path.join(FCM_OUTBOX_DIR, f), "utf8").then(JSON.parse)
        )
      );
      // The data payload is the mobile contract: Android renders it client-side.
      const payload = payloads.find(
        (p) => p.token === token && p.data?.notificationId === rows[0].id
      );
      expect(payload).toBeDefined();
      expect(payload.data).toMatchObject({
        type: "manufacturing_order_created",
        entityType: "manufacturing_order",
        entityId: orderId,
      });
      expect(payload.data.organizationId).toBeTruthy();
      expect(payload.data.title).toBeTruthy();
      expect(payload.data.body).toBeTruthy();

      const completeBody = JSON.stringify({
        actualQuantity: "3",
        outputDisposition: "available",
        confirmNegativeStock: false,
      });
      const completionHeaders = {
        "Idempotency-Key": `fast-mo-complete-notification-${orderId}`,
      };
      const complete = await testFetch(`/api/manufacturing-orders/${orderId}/complete`, {
        method: "POST",
        headers: completionHeaders,
        body: completeBody,
      });
      expect(complete.status).toBe(200);
      const replay = await testFetch(`/api/manufacturing-orders/${orderId}/complete`, {
        method: "POST",
        headers: completionHeaders,
        body: completeBody,
      });
      expect(replay.status).toBe(200);
      const completedRows = await db
        .select({
          id: notifications.id,
          deliveryStatus: notifications.deliveryStatus,
        })
        .from(notifications)
        .where(
          and(
            eq(notifications.entityId, orderId),
            eq(notifications.type, "manufacturing_order_completed"),
            eq(notifications.userId, testUser.id)
          )
        );
      expect(completedRows).toHaveLength(1);
      const completedRow = completedRows[0];
      expect(completedRow.deliveryStatus).toBe("delivered");

      const afterCompleteFiles = await fs.readdir(FCM_OUTBOX_DIR);
      const afterCompletePayloads = await Promise.all(
        afterCompleteFiles.map((f) =>
          fs.readFile(path.join(FCM_OUTBOX_DIR, f), "utf8").then(JSON.parse)
        )
      );
      const completedPayload = afterCompletePayloads.find(
        (p) => p.token === token && p.data?.notificationId === completedRow.id
      );
      expect(completedPayload).toBeDefined();
      expect(completedPayload.data).toMatchObject({
        type: "manufacturing_order_completed",
        entityType: "manufacturing_order",
        entityId: orderId,
      });
    } finally {
      // Leave the shared test user unsubscribed for other suites.
      await setNotificationPreference("manufacturing_order_created", false);
      await setNotificationPreference("manufacturing_order_completed", false);
    }
  });
});
