import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { test, expect, filterList, getIdFromUrl, selectDate } from "../fixtures";
import {
  inventoryEvents,
  inventoryDemandSummary,
  inventoryItemBalances,
  inventoryReservationsSummary,
  lots,
  manufacturingOrderBatches,
  manufacturingOrderIngredients,
  manufacturingOrders,
} from "../../../lib/db/schema";
import {
  createItem,
  createManufacturingOrder,
  createUnit,
  getUnitId,
  testFetch,
} from "../../helpers/api";

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
      stock: "100",
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
      stock: "100",
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
    expect(order.status).toBe("open");
    expect(order.priorityRank).not.toBeNull();
    expect(order.requestedQuantity).toBe("5.0000");
    expect(order.plannedQuantity).toBe("5.0000");
    expect(order.plannedDate).toBe("2026-04-25");
    expect(order.notes).toBe("Fast manufacturing smoke test");

    const listResponse = await testFetch("/api/manufacturing-orders");
    expect(listResponse.status).toBe(200);
    const listBody = (await listResponse.json()) as Array<Record<string, unknown>>;
    const listedOrder = listBody.find((row) => row.id === orderId);
    expect(listedOrder).toMatchObject({
      productCategory: `Fast Manufacturing ${ts}`,
      itemSpriteKind: "box",
      itemSpriteColor: "purple",
    });

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

  test("plans shared group remainder choices once per basis", async ({ db }) => {
    const groupTs = Date.now();
    const materialPayloads = [
      ["soil", "1.00", "500"],
      ["pallet", "5.00", "50"],
      ["wrap", "2.00", "50"],
      ["labels", "0.25", "200"],
    ] as const;
    const createdMaterials = await Promise.all(
      materialPayloads.map(([key, price, stock]) =>
        createItem({
          name: `Fast Group ${key} ${groupTs}`,
          itemType: "material",
          unitDefinitionId: unitId,
          sku: `FAST-GROUP-${key.toUpperCase()}-${groupTs}`,
          category: `Fast Group ${groupTs}`,
          description: null,
          defaultPurchasePrice: price,
          defaultSellingPrice: null,
          stock,
          safetyStock: "0",
          bom: [],
        })
      )
    );
    createdMaterials.forEach((result) => expect(result.status).toBe(201));
    const [soilId, palletId, wrapId, labelId] = createdMaterials.map(
      (result) => result.body.id as string
    );

    const productCreate = await createItem({
      name: `Fast Group Bag ${groupTs}`,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `FAST-GROUP-BAG-${groupTs}`,
      category: `Fast Group ${groupTs}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "12.00",
      stock: "0",
      safetyStock: "0",
      typicalGroupSize: "50",
      bom: [
        { componentId: soilId, quantity: "2", consumptionMode: "per_output_unit" },
        {
          componentId: palletId,
          quantity: "1",
          consumptionMode: "per_group",
          basisOutputQuantity: "50",
          groupRemainderPolicy: "ask",
        },
        {
          componentId: wrapId,
          quantity: "1",
          consumptionMode: "per_group",
          basisOutputQuantity: "50",
          groupRemainderPolicy: "ask",
        },
        {
          componentId: labelId,
          quantity: "4",
          consumptionMode: "per_group",
          basisOutputQuantity: "50",
          groupRemainderPolicy: "ask",
        },
      ],
    });
    expect(productCreate.status).toBe(201);
    const productIdForGroup = productCreate.body.id as string;
    const ingredients = [
      { itemId: soilId, quantityPerUnit: "2" },
      { itemId: palletId, quantityPerUnit: "1" },
      { itemId: wrapId, quantityPerUnit: "1" },
      { itemId: labelId, quantityPerUnit: "4" },
    ];

    const looseOrder = await createManufacturingOrder({
      productId: productIdForGroup,
      plannedQuantity: "52",
      ingredients,
      groupRemainderChoices: [
        { basisOutputQuantity: "50", handling: "leave_loose" },
      ],
    });
    expect(looseOrder.status).toBe(201);

    const looseRows = await db
      .select()
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, looseOrder.body.id));
    const looseByItem = new Map(looseRows.map((row) => [row.itemId, row]));
    expect(looseByItem.get(soilId)?.plannedQuantity).toBe("104.0000");
    expect(looseByItem.get(palletId)?.plannedQuantity).toBe("1.0000");
    expect(looseByItem.get(wrapId)?.plannedQuantity).toBe("1.0000");
    expect(looseByItem.get(labelId)?.plannedQuantity).toBe("4.0000");
    expect(looseByItem.get(palletId)?.chosenGroupRemainderHandling).toBe("leave_loose");
    expect(looseByItem.get(wrapId)?.chosenGroupRemainderHandling).toBe("leave_loose");
    expect(looseByItem.get(labelId)?.calculatedGroupCount).toBe("1.0000");

    const partialOrder = await createManufacturingOrder({
      productId: productIdForGroup,
      plannedQuantity: "52",
      ingredients,
      groupRemainderChoices: [
        { basisOutputQuantity: "50", handling: "create_partial_group" },
      ],
    });
    expect(partialOrder.status).toBe(201);

    const partialRows = await db
      .select()
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, partialOrder.body.id));
    const partialByItem = new Map(partialRows.map((row) => [row.itemId, row]));
    expect(partialByItem.get(palletId)?.plannedQuantity).toBe("2.0000");
    expect(partialByItem.get(wrapId)?.plannedQuantity).toBe("2.0000");
    expect(partialByItem.get(labelId)?.plannedQuantity).toBe("8.0000");
    expect(partialByItem.get(palletId)?.chosenGroupRemainderHandling).toBe(
      "create_partial_group"
    );
    expect(partialByItem.get(labelId)?.calculatedGroupCount).toBe("2.0000");

    const duplicateResponse = await testFetch(
      `/api/manufacturing-orders/${partialOrder.body.id}/duplicate`,
      { method: "POST" }
    );
    expect(duplicateResponse.status).toBe(201);
    const duplicateBody = await duplicateResponse.json();
    const duplicatedRows = await db
      .select()
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, duplicateBody.id));
    const duplicatedByItem = new Map(
      duplicatedRows.map((row) => [row.itemId, row])
    );
    expect(duplicatedByItem.get(palletId)?.plannedQuantity).toBe("2.0000");
    expect(duplicatedByItem.get(wrapId)?.plannedQuantity).toBe("2.0000");
    expect(duplicatedByItem.get(labelId)?.chosenGroupRemainderHandling).toBe(
      "create_partial_group"
    );
  });

  test("keeps batch order readiness based on execution ingredient rows", async () => {
    const batchTs = Date.now();
    const materialResult = await createItem({
      name: `Fast Batch Readiness Material ${batchTs}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-BATCH-READY-MAT-${batchTs}`,
      category: `Fast Batch Readiness ${batchTs}`,
      description: null,
      defaultPurchasePrice: "1",
      defaultSellingPrice: null,
      stock: "100",
      safetyStock: "0",
      bom: [],
    });
    expect(materialResult.status).toBe(201);
    const materialId = materialResult.body.id as string;

    const productResult = await createItem({
      name: `Fast Batch Readiness Product ${batchTs}`,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `FAST-BATCH-READY-PROD-${batchTs}`,
      category: `Fast Batch Readiness ${batchTs}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "10",
      stock: "0",
      safetyStock: "0",
      typicalBatchSize: "10",
      bom: [
        {
          componentId: materialId,
          quantity: "3",
          consumptionMode: "per_batch",
          basisOutputQuantity: "10",
          batchScalingMode: "full_batches_only",
        },
      ],
    });
    expect(productResult.status).toBe(201);
    const batchProductId = productResult.body.id as string;

    const orderResult = await createManufacturingOrder({
      productId: batchProductId,
      plannedQuantity: "12",
      ingredients: [{ itemId: materialId, quantityPerUnit: "3" }],
    });
    expect(orderResult.status).toBe(201);

    const listResponse = await testFetch("/api/manufacturing-orders");
    expect(listResponse.status).toBe(200);
    const rows = await listResponse.json();
    const row = rows.find(
      (candidate: { id: string }) => candidate.id === orderResult.body.id
    );
    expect(row).toMatchObject({
      manufacturingMode: "batch",
      ingredientReadiness: "in_stock",
    });
  });

  test("duplicates a manufacturing order from the detail actions", async ({
    page,
    db,
  }) => {
    await page.goto(`/manufacturing/orders/${orderId}`);
    await page.getByRole("button", { name: "More actions" }).click();

    const [duplicateResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith(`/api/manufacturing-orders/${orderId}/duplicate`)
      ),
      page.getByRole("menuitem", { name: "Duplicate" }).click(),
    ]);
    expect(duplicateResponse.status()).toBe(201);
    const created = await duplicateResponse.json();
    const duplicateId = created.id as string;
    await page.waitForURL(`**/manufacturing/orders/${duplicateId}`);
    expect(duplicateId).not.toBe(orderId);

    const [duplicate] = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, duplicateId));
    expect(duplicate.productId).toBe(productId);
    expect(duplicate.status).toBe("open");
    expect(duplicate.priorityRank).not.toBeNull();
    expect(duplicate.requestedQuantity).toBe("5.0000");
    expect(duplicate.plannedQuantity).toBe("5.0000");
    expect(duplicate.plannedDate).toBe("2026-04-25");
    expect(duplicate.notes).toBe("Fast manufacturing updated");
    expect(duplicate.salesOrderId).toBeNull();
    expect(duplicate.salesOrderLineId).toBeNull();

    const duplicateIngredients = await db
      .select()
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, duplicateId));
    expect(duplicateIngredients).toHaveLength(2);
    expect(duplicateIngredients.map((ingredient) => ingredient.itemId).sort()).toEqual(
      [sandId, compostId].sort()
    );
  });

  test("ranks open manufacturing orders", async ({
    page,
    db,
  }) => {
    const firstOrderResult = await createManufacturingOrder({
      productId,
      plannedQuantity: "2",
      plannedDate: "2026-04-26",
      notes: "Fast MO list position first",
      ingredients: [
        { itemId: sandId, quantityPerUnit: "2" },
        { itemId: compostId, quantityPerUnit: "1" },
      ],
    });
    const secondOrderResult = await createManufacturingOrder({
      productId,
      plannedQuantity: "2",
      plannedDate: "2026-04-26",
      notes: "Fast MO list position second",
      ingredients: [
        { itemId: sandId, quantityPerUnit: "2" },
        { itemId: compostId, quantityPerUnit: "1" },
      ],
    });
    expect(firstOrderResult.status).toBe(201);
    expect(secondOrderResult.status).toBe(201);

    const createdOrders = await db
      .select({
        id: manufacturingOrders.id,
        orderNumber: manufacturingOrders.orderNumber,
        priorityRank: manufacturingOrders.priorityRank,
      })
      .from(manufacturingOrders)
      .where(
        inArray(manufacturingOrders.id, [
          firstOrderResult.body.id as string,
          secondOrderResult.body.id as string,
        ])
      )
      .orderBy(asc(manufacturingOrders.orderNumber));
    expect(createdOrders).toHaveLength(2);
    const orderNumbers = createdOrders.map((order) => order.orderNumber);
    const [firstOrderNumber, secondOrderNumber] = orderNumbers;
    const [firstCreatedOrder, secondCreatedOrder] = createdOrders;
    if (!firstOrderNumber || !secondOrderNumber || !firstCreatedOrder || !secondCreatedOrder) {
      throw new Error("Expected two manufacturing orders.");
    }
    expect(firstCreatedOrder.priorityRank).not.toBeNull();
    expect(secondCreatedOrder.priorityRank).not.toBeNull();

    await page.goto("/manufacturing/orders");
    await filterList(page, "Search manufacturing orders", productName);
    await expect(
      page.getByRole("row", { name: new RegExp(firstOrderNumber) })
    ).toBeVisible();
    await expect(
      page.getByRole("row", { name: new RegExp(secondOrderNumber) })
    ).toBeVisible();

    const firstOrderRow = page.getByRole("row", {
      name: new RegExp(firstOrderNumber),
    });
    await firstOrderRow
      .getByRole("button", { name: new RegExp(`Manufacturing actions for ${firstOrderNumber}`) })
      .click();
    await expect(page.getByRole("menuitem", { name: "Execute" })).toBeVisible({
      timeout: 15_000,
    });
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("row", { name: new RegExp(secondOrderNumber) })
    ).toBeVisible();

    await page.getByRole("radio", { name: "Show open orders" }).click();
    await expect(
      page.getByRole("row", { name: new RegExp(firstOrderNumber) })
    ).toContainText("Not started", { timeout: 15_000 });
    await expect(
      page.getByRole("row", { name: new RegExp(secondOrderNumber) })
    ).toBeVisible();

    const openOrders = await db
      .select({ id: manufacturingOrders.id })
      .from(manufacturingOrders)
      .where(
        and(
          eq(manufacturingOrders.status, "open"),
          isNull(manufacturingOrders.deletedAt)
        )
      )
      .orderBy(asc(manufacturingOrders.priorityRank), asc(manufacturingOrders.orderNumber));
    const reorderedOpenOrderIds = [
      secondCreatedOrder.id,
      firstCreatedOrder.id,
      ...openOrders
        .map((order) => order.id)
        .filter(
          (id) => id !== firstCreatedOrder.id && id !== secondCreatedOrder.id
        ),
    ];
    const reorderResult = await testFetch("/api/manufacturing-orders/priority-ranks", {
      method: "PATCH",
      body: JSON.stringify({ orderIds: reorderedOpenOrderIds }),
    });
    expect(reorderResult.status).toBe(200);

    const rerankedOrders = await db
      .select({
        id: manufacturingOrders.id,
        priorityRank: manufacturingOrders.priorityRank,
      })
      .from(manufacturingOrders)
      .where(inArray(manufacturingOrders.id, [firstCreatedOrder.id, secondCreatedOrder.id]));
    const rankById = new Map(
      rerankedOrders.map((order) => [order.id, order.priorityRank])
    );
    expect(rankById.get(secondCreatedOrder.id)).toBe(1);
    expect(rankById.get(firstCreatedOrder.id)).toBe(2);

    await page.getByRole("radio", { name: "Show done orders" }).click();
    await expect(
      page.getByRole("row", { name: new RegExp(firstOrderNumber) })
    ).toBeHidden();
    await expect(
      page.getByRole("row", { name: new RegExp(secondOrderNumber) })
    ).toBeHidden();
  });

  test("uses generic requirement copy for pick override warnings", async ({
    page,
  }) => {
    const requirementTs = Date.now();
    const requirementMaterial = await createItem({
      name: `Fast Requirement Material ${requirementTs}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-REQ-MAT-${requirementTs}`,
      category: `Fast Requirement ${requirementTs}`,
      description: "Material for requirement warning copy",
      defaultPurchasePrice: "1.00",
      defaultSellingPrice: null,
      stock: "5",
      safetyStock: "0",
      bom: [],
    });
    expect(requirementMaterial.status).toBe(201);
    const requirementMaterialId = requirementMaterial.body.id as string;

    const requirementProduct = await createItem({
      name: `Fast Requirement Product ${requirementTs}`,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `FAST-REQ-PRODUCT-${requirementTs}`,
      category: `Fast Requirement ${requirementTs}`,
      description: "Product for requirement warning copy",
      defaultPurchasePrice: null,
      defaultSellingPrice: "10.00",
      stock: "0",
      safetyStock: "0",
      bom: [
        {
          componentId: requirementMaterialId,
          quantity: "1",
          minimumLotAgeDays: 7,
        },
      ],
    });
    expect(requirementProduct.status).toBe(201);
    const requirementProductId = requirementProduct.body.id as string;

    const order = await createManufacturingOrder({
      productId: requirementProductId,
      plannedQuantity: "2",
      ingredients: [{ itemId: requirementMaterialId, quantityPerUnit: "1" }],
      confirmShortage: true,
    });
    expect(order.status).toBe(201);
    const requirementOrderId = order.body.id as string;

    await page.goto(`/manufacturing/orders/${requirementOrderId}/execute`);
    await page.getByRole("button", { name: "Mark Done", exact: true }).click();

    const warningDialog = page.getByRole("alertdialog", {
      name: "Mark done with requirement override?",
    });
    await expect(warningDialog).toBeVisible({ timeout: 15_000 });
    await expect(warningDialog).toContainText(
      "Ingredient does not match the >= 7 days age requirement."
    );
    await expect(warningDialog).not.toContainText("under-age");
    await expect(warningDialog).not.toContainText("Lot must be at least");
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
        {
          componentId: batchSandId,
          quantity: "3",
          consumptionMode: "per_batch",
          basisOutputQuantity: "2",
          batchScalingMode: "full_batches_only",
        },
        {
          componentId: batchCompostId,
          quantity: "1",
          consumptionMode: "per_batch",
          basisOutputQuantity: "2",
          batchScalingMode: "full_batches_only",
        },
      ],
    });

    expect(batchProductCreate.status).toBe(201);
    const batchProductId = batchProductCreate.body.id as string;

    await page.goto("/manufacturing/orders/new");
    const productInput = page.getByPlaceholder("Search products...");
    await productInput.click();
    await productInput.fill(batchProductName);
    await page.getByRole("option", { name: new RegExp(batchProductName) }).click();

    await page.getByLabel("Planned Quantity").fill("6");
    await expect(page.getByText("3 batches")).toBeVisible();
    await expect(page.getByText(/of up to 2 test-unit-/)).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(batchSandName) })).toContainText("9");
    await expect(page.getByRole("row", { name: new RegExp(batchCompostName) })).toContainText("3");
    await page.getByLabel("Notes").fill("Fast batch execution smoke");
    await page.getByRole("button", { name: "Create Order" }).click();

    await page.waitForURL(/\/manufacturing\/orders\/[0-9a-f-]+$/);
    const batchOrderId = getIdFromUrl(page.url());

    const [openOrder] = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, batchOrderId));
    expect(openOrder.productId).toBe(batchProductId);
    expect(openOrder.status).toBe("open");
    expect(openOrder.plannedQuantity).toBe("6.0000");
    expect(openOrder.numberOfBatches).toBe(3);

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

      await sandCard.getByRole("button", { name: "Mark Done", exact: true }).click();
      await compostCard.getByRole("button", { name: "Mark Done", exact: true }).click();

      await expect
        .poll(
          async () => {
            const [currentBatch] = await db
              .select({ id: manufacturingOrderBatches.id })
              .from(manufacturingOrderBatches)
              .where(
                and(
                  eq(manufacturingOrderBatches.manufacturingOrderId, batchOrderId),
                  eq(manufacturingOrderBatches.status, "in_progress")
                )
              )
              .limit(1);

            if (!currentBatch) return false;

            const rows = await db
              .select({
                plannedQuantity: manufacturingOrderIngredients.plannedQuantity,
                pickedQuantity: manufacturingOrderIngredients.pickedQuantity,
              })
              .from(manufacturingOrderIngredients)
              .where(
                eq(
                  manufacturingOrderIngredients.manufacturingOrderBatchId,
                  currentBatch.id
                )
              );

            return (
              rows.length > 0 &&
              rows.every((row) => row.pickedQuantity === row.plannedQuantity)
            );
          },
          { timeout: 15_000 }
        )
        .toBe(true);

      await page.reload();
      await expect(page.getByRole("button", { name: "Complete Batch" })).toBeEnabled();
      await page.getByRole("button", { name: "Complete Batch" }).click();
      await page.getByLabel("Actual Output").fill(output);
      await page.getByRole("button", { name: "Confirm" }).click();

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
        status: "done",
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

  test("keeps execution detail reads side-effect free for open batch orders", async ({
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
        notes: "Open batch read regression",
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

    const createdIngredients = await db
      .select()
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, legacyOrderId));
    expect(createdIngredients).toHaveLength(6);
    const draftTemplateIngredients = [
      createdIngredients.find((ingredient) => ingredient.sortOrder === 0),
      createdIngredients.find((ingredient) => ingredient.sortOrder === 1),
    ];
    if (!draftTemplateIngredients[0] || !draftTemplateIngredients[1]) {
      throw new Error("Expected batch ingredients to seed legacy template rows.");
    }

    await db
      .delete(manufacturingOrderBatches)
      .where(eq(manufacturingOrderBatches.manufacturingOrderId, legacyOrderId));
    await db
      .delete(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, legacyOrderId));

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

  test("creates an open order with an approved alternate and consumes alternate stock", async ({
    db,
  }) => {
    const alternateTs = Date.now();
    const defaultUnit = await createUnit({
      name: `Fast MO Bale 3100L ${alternateTs}`,
      size: "3100",
      uom: "l",
    });
    const alternateUnit = await createUnit({
      name: `Fast MO Bale 225L ${alternateTs}`,
      size: "225",
      uom: "l",
    });
    expect(defaultUnit.status).toBe(201);
    expect(alternateUnit.status).toBe(201);

    const defaultMaterial = await createItem({
      name: `Fast MO Sphagnum 3100L ${alternateTs}`,
      itemType: "material",
      unitDefinitionId: defaultUnit.body.id,
      sku: `FAST-MO-SPHAG-3100-${alternateTs}`,
      category: `Fast Alternates ${alternateTs}`,
      description: "Default large bale",
      defaultPurchasePrice: "232.10",
      defaultSellingPrice: null,
      stock: "1",
      safetyStock: "0",
      bom: [],
    });
    const alternateMaterial = await createItem({
      name: `Fast MO Sphagnum 225L ${alternateTs}`,
      itemType: "material",
      unitDefinitionId: alternateUnit.body.id,
      sku: `FAST-MO-SPHAG-225-${alternateTs}`,
      category: `Fast Alternates ${alternateTs}`,
      description: "Approved smaller bale",
      defaultPurchasePrice: "16.84",
      defaultSellingPrice: null,
      stock: "20",
      safetyStock: "0",
      bom: [],
    });
    expect(defaultMaterial.status).toBe(201);
    expect(alternateMaterial.status).toBe(201);

    const product = await createItem({
      name: `Fast MO Expanded Sphagnum ${alternateTs}`,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `FAST-MO-SPHAG-EXP-${alternateTs}`,
      category: `Fast Alternates ${alternateTs}`,
      description: "Expanded sphagnum with approved raw material alternate",
      defaultPurchasePrice: null,
      defaultSellingPrice: "25.00",
      stock: "0",
      safetyStock: "0",
      bom: [
        {
          componentId: defaultMaterial.body.id,
          quantity: "0.145",
          alternates: [{ itemId: alternateMaterial.body.id }],
        },
      ],
    });
    expect(product.status).toBe(201);

    const createOrderResponse = await testFetch("/api/manufacturing-orders", {
      method: "POST",
      body: JSON.stringify({
        productId: product.body.id,
        plannedQuantity: "2",
        plannedDate: null,
        notes: "Fast material alternate smoke",
        ingredients: [
          {
            itemId: alternateMaterial.body.id,
            quantityPerUnit: "1.9978",
          },
        ],
      }),
    });
    expect(createOrderResponse.status).toBe(201);
    const createdOrder = await createOrderResponse.json();
    const alternateOrderId = createdOrder.id as string;

    const [releasedIngredient] = await db
      .select()
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, alternateOrderId));
    expect(releasedIngredient.itemId).toBe(alternateMaterial.body.id);
    expect(releasedIngredient.plannedQuantity).toBe("3.9956");

    const [alternateDemand] = await db
      .select({
        itemId: inventoryDemandSummary.itemId,
        quantity: inventoryDemandSummary.quantity,
      })
      .from(inventoryDemandSummary)
      .where(eq(inventoryDemandSummary.referenceId, releasedIngredient.id));
    expect(alternateDemand).toEqual({
      itemId: alternateMaterial.body.id,
      quantity: "3.9956",
    });

    const [alternateReservation] = await db
      .select({
        itemId: inventoryReservationsSummary.itemId,
        quantity: inventoryReservationsSummary.quantity,
      })
      .from(inventoryReservationsSummary)
      .where(eq(inventoryReservationsSummary.referenceId, releasedIngredient.id));
    expect(alternateReservation).toBeUndefined();

    const pickResponse = await testFetch(
      `/api/manufacturing-orders/${alternateOrderId}/ingredients/${releasedIngredient.id}/pick`,
      { method: "POST", body: JSON.stringify({}) }
    );
    expect(pickResponse.status).toBe(200);

    const [consumptionEvent] = await db
      .select({
        itemId: inventoryEvents.itemId,
        quantity: inventoryEvents.quantity,
      })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.referenceId, alternateOrderId),
          eq(inventoryEvents.eventType, "manufacturing_ingredient_consumption")
        )
      );
    expect(consumptionEvent).toEqual({
      itemId: alternateMaterial.body.id,
      quantity: "3.9956",
    });

    await db
      .update(manufacturingOrderIngredients)
      .set({ actualQuantity: "0" })
      .where(eq(manufacturingOrderIngredients.id, releasedIngredient.id));

    const deleteResponse = await testFetch(
      `/api/manufacturing-orders/${alternateOrderId}`,
      { method: "DELETE" }
    );
    const deleteBody = await deleteResponse.json();
    expect(deleteResponse.status).toBe(400);
    expect(deleteBody.error).toContain("finalized ingredient consumption");

    const [blockedOrder] = await db
      .select({ deletedAt: manufacturingOrders.deletedAt })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, alternateOrderId));
    expect(blockedOrder.deletedAt).toBeNull();

    const [alternateBalance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, alternateMaterial.body.id));
    expect(alternateBalance?.onHandQty).toBe("16.0044");
  });
});
