import { eq } from "drizzle-orm";
import { test, expect, getIdFromUrl, selectDate } from "../fixtures";
import {
  inventoryEvents,
  inventoryItemBalances,
  lots,
  manufacturingOrderBatches,
  manufacturingOrderIngredients,
  manufacturingOrders,
} from "../../../lib/db/schema";
import { createItem, getUnitId, testFetch } from "../../helpers/api";

test.describe("Manufacturing write-path smoke", () => {
  test.describe.configure({ mode: "serial" });

  const ts = Date.now();
  const unitId = getUnitId();
  const sandName = `Fast MO Sand ${ts}`;
  const compostName = `Fast MO Compost ${ts}`;
  const productName = `Fast MO Blend ${ts}`;
  let productId = "";
  let sandId = "";
  let compostId = "";
  let orderId = "";

  test("creates and edits a manufacturing order through the browser form", async ({
    page,
    db,
  }) => {
    const sandCreate = await createItem({
      name: sandName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-MO-SAND-${ts}`,
      category: `Fast Manufacturing ${ts}`,
      description: "Fast manufacturing sand",
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "20",
      safetyStock: "0",
      bom: [],
    });
    const compostCreate = await createItem({
      name: compostName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-MO-COMPOST-${ts}`,
      category: `Fast Manufacturing ${ts}`,
      description: "Fast manufacturing compost",
      defaultPurchasePrice: "3.00",
      defaultSellingPrice: null,
      stock: "20",
      safetyStock: "0",
      bom: [],
    });

    expect(sandCreate.status).toBe(201);
    expect(compostCreate.status).toBe(201);
    sandId = sandCreate.body.id;
    compostId = compostCreate.body.id;

    const productCreate = await createItem({
      name: productName,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `FAST-MO-PRODUCT-${ts}`,
      category: `Fast Manufacturing ${ts}`,
      description: "Fast manufacturing product",
      defaultPurchasePrice: null,
      defaultSellingPrice: "45.00",
      stock: "0",
      safetyStock: "0",
      bom: [
        { componentId: sandId, quantity: "2" },
        { componentId: compostId, quantity: "1" },
      ],
    });

    expect(productCreate.status).toBe(201);
    productId = productCreate.body.id;

    await page.goto("/manufacturing/orders/new");
    await expect(page.getByText("Add Manufacturing Order")).toBeVisible();

    const productInput = page.getByPlaceholder("Search products...");
    await productInput.click();
    await productInput.fill(productName);
    await page.getByRole("option", { name: new RegExp(productName) }).click();

    await page.getByLabel("Planned Quantity").fill("5");
    await selectDate(page, page.getByLabel("Planned Date"), "2026-04-25");
    await page.getByLabel("Notes").fill("Fast manufacturing smoke test");
    const [createResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/api/manufacturing-orders")
      ),
      page.getByRole("button", { name: "Create Order" }).click(),
    ]);
    expect(createResponse.status()).toBe(201);

    await page.waitForURL(/\/manufacturing\/orders\/[0-9a-f-]+$/);
    orderId = getIdFromUrl(page.url());
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/MO-\d{4}-\d{4}/);

    const [order] = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, orderId));
    expect(order.productId).toBe(productId);
    expect(order.status).toBe("draft");
    expect(order.requestedQuantity).toBe("5.0000");
    expect(order.plannedQuantity).toBe("5.0000");
    expect(order.plannedDate).toBe("2026-04-25");
    expect(order.notes).toBe("Fast manufacturing smoke test");

    const ingredients = await db
      .select()
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, orderId));
    expect(ingredients).toHaveLength(2);

    await page.goto(`/manufacturing/orders/${orderId}/edit`);
    await page.waitForURL(`**/manufacturing/orders/${orderId}/edit`);
    await expect(
      page.getByRole("heading", { name: "Edit Manufacturing Order" })
    ).toBeVisible();
    const notesField = page.getByLabel("Notes");
    await expect(notesField).toHaveValue("Fast manufacturing smoke test");
    await notesField.click();
    await notesField.press("Control+A");
    await notesField.type("Fast manufacturing updated");
    const updateResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        response.url().endsWith(`/api/manufacturing-orders/${orderId}`)
    );
    await page.getByRole("button", { name: "Save Changes" }).click();
    expect((await updateResponsePromise).status()).toBe(200);
    await page.waitForURL(`**/manufacturing/orders/${orderId}`);

    const [updatedOrder] = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, orderId));
    expect(updatedOrder.notes).toBe("Fast manufacturing updated");
  });

  test("runs a batch-mode order through sequential batch execution", async ({
    page,
    db,
  }) => {
    test.slow();

    const batchTs = Date.now();
    const batchSandName = `Fast Batch Sand ${batchTs}`;
    const batchCompostName = `Fast Batch Compost ${batchTs}`;
    const batchProductName = `Fast Batch Blend ${batchTs}`;

    const batchSandCreate = await createItem({
      name: batchSandName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-BATCH-SAND-${batchTs}`,
      category: `Fast Batch ${batchTs}`,
      description: "Fast batch sand",
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "20",
      safetyStock: "0",
      bom: [],
    });
    const batchCompostCreate = await createItem({
      name: batchCompostName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-BATCH-COMPOST-${batchTs}`,
      category: `Fast Batch ${batchTs}`,
      description: "Fast batch compost",
      defaultPurchasePrice: "4.00",
      defaultSellingPrice: null,
      stock: "10",
      safetyStock: "0",
      bom: [],
    });

    expect(batchSandCreate.status).toBe(201);
    expect(batchCompostCreate.status).toBe(201);

    const batchSandId = batchSandCreate.body.id as string;
    const batchCompostId = batchCompostCreate.body.id as string;

    const batchProductCreate = await createItem({
      name: batchProductName,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `FAST-BATCH-PRODUCT-${batchTs}`,
      category: `Fast Batch ${batchTs}`,
      description: "Fast batch product",
      defaultPurchasePrice: null,
      defaultSellingPrice: "60.00",
      stock: "0",
      safetyStock: "0",
      manufacturingMode: "batch",
      expectedBatchYield: "2",
      bom: [
        { componentId: batchSandId, quantity: "3" },
        { componentId: batchCompostId, quantity: "1" },
      ],
    });

    expect(batchProductCreate.status).toBe(201);
    const batchProductId = batchProductCreate.body.id as string;

    await page.goto("/manufacturing/orders/new");
    const productInput = page.getByPlaceholder("Search products...");
    await productInput.click();
    await productInput.fill(batchProductName);
    await page.getByRole("option", { name: new RegExp(batchProductName) }).click();

    await page.getByLabel("Planned Quantity").fill("5");
    await page.getByLabel("Notes").fill("Fast batch execution smoke");
    await page.getByRole("button", { name: "Create Order" }).click();

    await page.waitForURL(/\/manufacturing\/orders\/[0-9a-f-]+$/);
    const batchOrderId = getIdFromUrl(page.url());

    const [draftOrder] = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, batchOrderId));
    expect(draftOrder.productId).toBe(batchProductId);
    expect(draftOrder.plannedQuantity).toBe("6.0000");
    expect(draftOrder.numberOfBatches).toBe(3);

    await page.getByRole("button", { name: "Release" }).click();
    await expect(page.getByRole("link", { name: "Execute" })).toBeVisible({
      timeout: 15_000,
    });

    const createdBatches = await db
      .select()
      .from(manufacturingOrderBatches)
      .where(eq(manufacturingOrderBatches.manufacturingOrderId, batchOrderId));
    expect(createdBatches).toHaveLength(3);

    const batchIngredients = await db
      .select()
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, batchOrderId));
    expect(batchIngredients).toHaveLength(6);

    const sortedBatches = [...createdBatches].sort((left, right) => left.batchNumber - right.batchNumber);
    const blockedBatch = sortedBatches[1];
    expect(blockedBatch).toBeDefined();
    if (!blockedBatch) {
      throw new Error("Expected a second batch for out-of-order execution coverage");
    }

    const blockedIngredient = batchIngredients.find(
      (ingredient) => ingredient.manufacturingOrderBatchId === blockedBatch.id
    );
    expect(blockedIngredient).toBeDefined();
    if (!blockedIngredient) {
      throw new Error("Expected an ingredient row for the blocked batch");
    }

    const blockedStartResponse = await testFetch(
      `/api/manufacturing-orders/${batchOrderId}/batches/${blockedBatch.id}/start`,
      {
        method: "POST",
      }
    );
    expect(blockedStartResponse.status).toBe(400);

    const blockedPickResponse = await testFetch(
      `/api/manufacturing-orders/${batchOrderId}/ingredients/${blockedIngredient.id}/pick`,
      {
        method: "POST",
      }
    );
    expect(blockedPickResponse.status).toBe(400);

    const blockedCompleteResponse = await testFetch(
      `/api/manufacturing-orders/${batchOrderId}/batches/${blockedBatch.id}/complete`,
      {
        method: "POST",
        body: JSON.stringify({ actualQuantity: "2" }),
      }
    );
    expect(blockedCompleteResponse.status).toBe(400);

    await page.getByRole("link", { name: "Execute" }).click();
    await page.waitForURL(`**/manufacturing/orders/${batchOrderId}/execute`);

    const runBatch = async (output: string, expectedActual: string, expectedExpected: string) => {
      await page.getByRole("button", { name: "Start Batch" }).click();

      const sandCard = page
        .locator('[data-slot="card"]')
        .filter({ hasText: batchSandName })
        .first();
      const compostCard = page
        .locator('[data-slot="card"]')
        .filter({ hasText: batchCompostName })
        .first();

      await sandCard.getByRole("button", { name: /Pick / }).click();
      await compostCard.getByRole("button", { name: /Pick / }).click();

      await page.getByLabel("Actual Output").fill(output);
      await page.getByRole("button", { name: "Complete Batch" }).click();

      await expect
        .poll(
          async () => {
            const [currentOrder] = await db
              .select({
                actualQuantity: manufacturingOrders.actualQuantity,
                expectedQty: inventoryItemBalances.expectedQty,
              })
              .from(manufacturingOrders)
              .innerJoin(
                inventoryItemBalances,
                eq(inventoryItemBalances.itemId, manufacturingOrders.productId)
              )
              .where(eq(manufacturingOrders.id, batchOrderId));

            return {
              actualQuantity: currentOrder?.actualQuantity ?? null,
              expectedQty: currentOrder?.expectedQty ?? null,
            };
          },
          { timeout: 15_000 }
        )
        .toEqual({
          actualQuantity: expectedActual,
          expectedQty: expectedExpected,
        });
    };

    await runBatch("2", "2.0000", "4.0000");
    await runBatch("1.5", "3.5000", "2.5000");
    await runBatch("2.2", "5.7000", "0.0000");

    await expect
      .poll(
        async () => {
          const [completedOrder] = await db
            .select({
              status: manufacturingOrders.status,
              actualQuantity: manufacturingOrders.actualQuantity,
            })
            .from(manufacturingOrders)
            .where(eq(manufacturingOrders.id, batchOrderId));

          return completedOrder ?? null;
        },
        { timeout: 15_000 }
      )
      .toEqual({
        status: "completed",
        actualQuantity: "5.7000",
      });

    const completedBatches = await db
      .select()
      .from(manufacturingOrderBatches)
      .where(eq(manufacturingOrderBatches.manufacturingOrderId, batchOrderId));
    expect(completedBatches).toHaveLength(3);
    expect(completedBatches.every((batch) => batch.status === "completed")).toBe(true);

    const producedLots = await db.select().from(lots).where(eq(lots.itemId, batchProductId));
    expect(producedLots).toHaveLength(3);

    const movements = await db
      .select({
        eventType: inventoryEvents.eventType,
      })
      .from(inventoryEvents)
      .where(eq(inventoryEvents.referenceId, batchOrderId));
    expect(movements).toHaveLength(13);
    expect(
      movements.filter((movement) => movement.eventType === "expected_increase")
    ).toHaveLength(1);
    expect(
      movements.filter(
        (movement) => movement.eventType === "manufacturing_ingredient_consumption"
      )
    ).toHaveLength(6);
    expect(
      movements.filter((movement) => movement.eventType === "manufacturing_output")
    ).toHaveLength(3);
    expect(
      movements.filter((movement) => movement.eventType === "expected_release")
    ).toHaveLength(3);
  });

  test("keeps execution detail reads side-effect free for released batch orders", async ({
    db,
  }) => {
    const legacyTs = Date.now();
    const legacySandCreate = await createItem({
      name: `Legacy Batch Sand ${legacyTs}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `LEGACY-BATCH-SAND-${legacyTs}`,
      category: `Legacy Batch ${legacyTs}`,
      description: "Legacy batch sand",
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "20",
      safetyStock: "0",
      bom: [],
    });
    const legacyCompostCreate = await createItem({
      name: `Legacy Batch Compost ${legacyTs}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `LEGACY-BATCH-COMPOST-${legacyTs}`,
      category: `Legacy Batch ${legacyTs}`,
      description: "Legacy batch compost",
      defaultPurchasePrice: "4.00",
      defaultSellingPrice: null,
      stock: "10",
      safetyStock: "0",
      bom: [],
    });

    expect(legacySandCreate.status).toBe(201);
    expect(legacyCompostCreate.status).toBe(201);

    const legacyProductCreate = await createItem({
      name: `Legacy Batch Blend ${legacyTs}`,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `LEGACY-BATCH-PRODUCT-${legacyTs}`,
      category: `Legacy Batch ${legacyTs}`,
      description: "Legacy batch product",
      defaultPurchasePrice: null,
      defaultSellingPrice: "60.00",
      stock: "0",
      safetyStock: "0",
      manufacturingMode: "batch",
      expectedBatchYield: "2",
      bom: [
        { componentId: legacySandCreate.body.id as string, quantity: "3" },
        { componentId: legacyCompostCreate.body.id as string, quantity: "1" },
      ],
    });

    expect(legacyProductCreate.status).toBe(201);

    const createOrderResponse = await testFetch("/api/manufacturing-orders", {
      method: "POST",
      body: JSON.stringify({
        productId: legacyProductCreate.body.id,
        plannedQuantity: "5",
        plannedDate: null,
        notes: "Legacy released batch read regression",
        ingredients: [
          {
            itemId: legacySandCreate.body.id,
            quantityPerUnit: "3",
          },
          {
            itemId: legacyCompostCreate.body.id,
            quantityPerUnit: "1",
          },
        ],
      }),
    });
    expect(createOrderResponse.status).toBe(201);
    const createOrderBody = await createOrderResponse.json();
    const legacyOrderId = createOrderBody.id as string;

    const draftTemplateIngredients = await db
      .select()
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, legacyOrderId));
    expect(draftTemplateIngredients).toHaveLength(2);

    const releaseResponse = await testFetch(`/api/manufacturing-orders/${legacyOrderId}/release`, {
      method: "POST",
      body: JSON.stringify({ confirmShortage: false }),
    });
    expect(releaseResponse.status).toBe(200);

    await db
      .delete(manufacturingOrderBatches)
      .where(eq(manufacturingOrderBatches.manufacturingOrderId, legacyOrderId));

    await db.insert(manufacturingOrderIngredients).values(
      draftTemplateIngredients.map((ingredient) => ({
        manufacturingOrderId: legacyOrderId,
        manufacturingOrderBatchId: null,
        itemId: ingredient.itemId,
        itemName: ingredient.itemName,
        itemSku: ingredient.itemSku,
        itemType: ingredient.itemType,
        unitName: ingredient.unitName,
        quantityPerUnit: ingredient.quantityPerUnit,
        plannedQuantity: ingredient.plannedQuantity,
        pickedQuantity: "0",
        pickStatus: "not_picked",
        pickedAt: null,
        sortOrder: ingredient.sortOrder,
      }))
    );

    const beforeReadBatches = await db
      .select()
      .from(manufacturingOrderBatches)
      .where(eq(manufacturingOrderBatches.manufacturingOrderId, legacyOrderId));
    expect(beforeReadBatches).toHaveLength(0);

    const executionResponse = await testFetch(
      `/api/manufacturing-orders/${legacyOrderId}/execution`
    );
    expect(executionResponse.status).toBe(200);

    const afterReadBatches = await db
      .select()
      .from(manufacturingOrderBatches)
      .where(eq(manufacturingOrderBatches.manufacturingOrderId, legacyOrderId));
    expect(afterReadBatches).toHaveLength(0);

    const afterReadTemplateIngredients = await db
      .select()
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, legacyOrderId));
    expect(afterReadTemplateIngredients).toHaveLength(2);
    expect(
      afterReadTemplateIngredients.every(
        (ingredient) => ingredient.manufacturingOrderBatchId == null
      )
    ).toBe(true);
  });
});
