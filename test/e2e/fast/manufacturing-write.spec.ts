import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { test, expect, filterList, getIdFromUrl, selectDate } from "../fixtures";
import {
  bomRevisionOperationCosts,
  bomRevisions,
  inventoryEvents,
  inventoryDemandSummary,
  inventoryItemBalances,
  inventoryLotBalances,
  inventoryReservationsSummary,
  lots,
  manufacturingOrderBatches,
  manufacturingOrderIngredients,
  manufacturingOrderOutputConsumptions,
  manufacturingOrderOutputs,
  manufacturingOrderOperationCosts,
  manufacturingOrders,
  salesOrderLines,
  stockAllocations,
} from "../../../lib/db/schema";
import {
  createItem,
  createManufacturingOrder,
  createUnit,
  completeManufacturingOrder,
  getUnitId,
  testFetch,
  updateItem,
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
    await expect(productInput).toHaveValue(productName);

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
    const ingredientIds = ingredients.map((ingredient) => ingredient.id);
    const ingredientAllocations = await db
      .select({
        demandId: stockAllocations.demandId,
        itemId: stockAllocations.itemId,
        sourceType: stockAllocations.sourceType,
        quantity: stockAllocations.quantity,
      })
      .from(stockAllocations)
      .where(
        and(
          eq(stockAllocations.demandType, "manufacturing_order_ingredient"),
          inArray(stockAllocations.demandId, ingredientIds),
          eq(stockAllocations.status, "active")
        )
      );
    expect(ingredientAllocations).toHaveLength(2);
    const allocatedByItemId = new Map(
      ingredientAllocations.map((allocation) => [
        allocation.itemId,
        {
          sourceType: allocation.sourceType,
          quantity: parseFloat(allocation.quantity),
        },
      ])
    );
    expect(allocatedByItemId.get(sandId)).toMatchObject({
      sourceType: "inventory_lot",
      quantity: 10,
    });
    expect(allocatedByItemId.get(compostId)).toMatchObject({
      sourceType: "inventory_lot",
      quantity: 5,
    });

    // The /edit route now redirects into the inline-editable detail sheet.
    await page.goto(`/manufacturing/orders/${orderId}/edit`);
    await page.waitForURL(`**/manufacturing/orders/${orderId}`);
    const notesField = page.getByLabel("Notes");
    await expect(notesField).toHaveValue("Fast manufacturing smoke test");
    await notesField.click();
    await notesField.press("Control+A");
    await notesField.fill("Fast manufacturing updated");
    const updateResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().endsWith(`/api/manufacturing-orders/${orderId}`)
    );
    // Blur triggers the inline autosave PATCH.
    await page.getByRole("heading", { name: "Order details" }).click();
    expect((await updateResponsePromise).status()).toBe(200);

    await expect
      .poll(async () => {
        const [row] = await db
          .select()
          .from(manufacturingOrders)
          .where(eq(manufacturingOrders.id, orderId));
        return row.notes;
      })
      .toBe("Fast manufacturing updated");
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

    const productsResponse = await testFetch("/api/manufacturing-products");
    expect(productsResponse.status).toBe(200);
    const products = await productsResponse.json();
    const template = products.find(
      (candidate: { id: string }) => candidate.id === batchProductId
    );
    expect(template).toMatchObject({
      manufacturingMode: "batch",
      expectedBatchYield: "10",
    });

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

  test("spreads grouped materials across batch execution rows", async ({ db }) => {
    const groupBatchTs = Date.now();
    const processMaterialResult = await createItem({
      name: `Fast Group Batch Process ${groupBatchTs}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-GROUP-BATCH-PROCESS-${groupBatchTs}`,
      category: `Fast Group Batch ${groupBatchTs}`,
      description: null,
      defaultPurchasePrice: "1",
      defaultSellingPrice: null,
      stock: "100",
      safetyStock: "0",
      bom: [],
    });
    const groupedMaterialResult = await createItem({
      name: `Fast Group Batch Pallet ${groupBatchTs}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-GROUP-BATCH-PALLET-${groupBatchTs}`,
      category: `Fast Group Batch ${groupBatchTs}`,
      description: null,
      defaultPurchasePrice: "1",
      defaultSellingPrice: null,
      stock: "20",
      safetyStock: "0",
      bom: [],
    });
    expect(processMaterialResult.status).toBe(201);
    expect(groupedMaterialResult.status).toBe(201);
    const processMaterialId = processMaterialResult.body.id as string;
    const groupedMaterialId = groupedMaterialResult.body.id as string;

    const productResult = await createItem({
      name: `Fast Group Batch Product ${groupBatchTs}`,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `FAST-GROUP-BATCH-PROD-${groupBatchTs}`,
      category: `Fast Group Batch ${groupBatchTs}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "10",
      stock: "0",
      safetyStock: "0",
      typicalBatchSize: "8.75",
      bom: [
        {
          componentId: processMaterialId,
          quantity: "1",
          consumptionMode: "per_batch",
          basisOutputQuantity: "8.75",
          batchScalingMode: "full_batches_only",
        },
        {
          componentId: groupedMaterialId,
          quantity: "1",
          consumptionMode: "per_group",
          basisOutputQuantity: "3",
          groupRemainderPolicy: "create_partial_group",
        },
      ],
    });
    expect(productResult.status).toBe(201);

    const orderResult = await createManufacturingOrder({
      productId: productResult.body.id as string,
      plannedQuantity: "26.25",
      ingredients: [
        { itemId: processMaterialId, quantityPerUnit: "1" },
        { itemId: groupedMaterialId, quantityPerUnit: "1" },
      ],
    });
    expect(orderResult.status).toBe(201);

    const batches = await db
      .select()
      .from(manufacturingOrderBatches)
      .where(eq(manufacturingOrderBatches.manufacturingOrderId, orderResult.body.id))
      .orderBy(asc(manufacturingOrderBatches.batchNumber));
    expect(batches).toHaveLength(3);

    const groupedRows = await db
      .select({
        batchId: manufacturingOrderIngredients.manufacturingOrderBatchId,
        plannedQuantity: manufacturingOrderIngredients.plannedQuantity,
        calculatedGroupCount: manufacturingOrderIngredients.calculatedGroupCount,
      })
      .from(manufacturingOrderIngredients)
      .where(
        and(
          eq(manufacturingOrderIngredients.manufacturingOrderId, orderResult.body.id),
          eq(manufacturingOrderIngredients.itemId, groupedMaterialId)
        )
      )
      .orderBy(asc(manufacturingOrderIngredients.id));

    expect(groupedRows).toHaveLength(3);
    expect(groupedRows.map((row) => row.batchId).sort()).toEqual(
      batches.map((batch) => batch.id).sort()
    );
    expect(groupedRows.map((row) => row.plannedQuantity)).toEqual([
      "3.0000",
      "3.0000",
      "3.0000",
    ]);
    expect(groupedRows.map((row) => row.calculatedGroupCount)).toEqual([
      "3.0000",
      "3.0000",
      "3.0000",
    ]);
  });

  test("ignores product compatibility mode when BOM has no batch lines", async ({ db }) => {
    const compatTs = Date.now();
    const materialResult = await createItem({
      name: `Fast Compat Material ${compatTs}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-COMPAT-MAT-${compatTs}`,
      category: `Fast Compat ${compatTs}`,
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
      name: `Fast Compat Product ${compatTs}`,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `FAST-COMPAT-PROD-${compatTs}`,
      category: `Fast Compat ${compatTs}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "10",
      stock: "0",
      safetyStock: "0",
      manufacturingMode: "batch",
      expectedBatchYield: "10",
      bom: [{ componentId: materialId, quantity: "1" }],
    });
    expect(productResult.status).toBe(201);
    const productId = productResult.body.id as string;

    const productsResponse = await testFetch("/api/manufacturing-products");
    expect(productsResponse.status).toBe(200);
    const products = await productsResponse.json();
    const template = products.find(
      (candidate: { id: string }) => candidate.id === productId
    );
    expect(template).toMatchObject({
      manufacturingMode: "discrete",
      expectedBatchYield: null,
    });

    const orderResult = await createManufacturingOrder({
      productId,
      plannedQuantity: "4",
      ingredients: [{ itemId: materialId, quantityPerUnit: "1" }],
    });
    expect(orderResult.status).toBe(201);

    const [order] = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, orderResult.body.id as string));
    expect(order.manufacturingMode).toBe("discrete");
    expect(order.numberOfBatches).toBeNull();
    expect(order.expectedBatchYield).toBeNull();
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
    const markDoneButton = page
      .getByRole("button", { name: "Mark Done", exact: true })
      .first();
    await expect(markDoneButton).toBeEnabled({ timeout: 15_000 });
    const [pickResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().includes(
            `/api/manufacturing-orders/${requirementOrderId}/ingredients/`
          ) &&
          response.url().endsWith("/pick")
      ),
      markDoneButton.click(),
    ]);
    expect(pickResponse.status()).toBe(409);
    const pickBody = await pickResponse.json();
    const warningIngredient = pickBody.shortage?.ingredients?.[0];
    expect(warningIngredient?.warningType).toBe("requirement_violation");
    expect(warningIngredient?.requirement).toBe(
      "Ingredient does not match the >= 7 days age requirement."
    );
    expect(warningIngredient?.requirementViolations).toHaveLength(1);
    expect(warningIngredient?.requirementViolations?.[0]).toMatchObject({
      requirementType: "lot_age_min_days",
      status: "block",
      label: "Age ≥ 7d",
      message: "Lots must be at least 7 days old based on received date.",
      config: { days: 7, basis: "received_at" },
      overrideAllowed: true,
      overrideReasonRequired: false,
    });

    const warningDialog = page.getByRole("alertdialog", {
      name: "Mark done with requirement override?",
    });
    await expect(warningDialog).toBeVisible({ timeout: 15_000 });
    await expect(warningDialog).toContainText("Age ≥ 7d");
    await expect(warningDialog).toContainText(
      "Lots must be at least 7 days old based on received date."
    );
    await expect(warningDialog).not.toContainText("under-age");
  });

  test("direct order completion records manufacturing output detail", async ({
    db,
  }) => {
    const directTs = Date.now();
    const material = await createItem({
      name: `Fast Direct Output Material ${directTs}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-DIRECT-OUTPUT-MAT-${directTs}`,
      category: `Fast Direct Output ${directTs}`,
      description: "Material for direct output detail coverage",
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "20",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);
    const materialId = material.body.id as string;

    const resource = await testFetch("/api/manufacturing-resources", {
      method: "POST",
      body: JSON.stringify({
        name: `Fast Direct Output Crew ${directTs}`,
        description: null,
        resourceType: "labor",
        loadedCostPerHour: "30.0000",
      }),
    });
    expect(resource.status).toBe(201);
    const resourceBody = await resource.json();
    const resourceId = resourceBody.id as string;

    const product = await createItem({
      name: `Fast Direct Output Product ${directTs}`,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `FAST-DIRECT-OUTPUT-PRODUCT-${directTs}`,
      category: `Fast Direct Output ${directTs}`,
      description: "Product for direct output detail coverage",
      defaultPurchasePrice: null,
      defaultSellingPrice: "10.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: materialId, quantity: "2" }],
      standardCostQuantity: "4",
      operationCosts: [
        {
          operationName: "Direct output crew",
          resourceId,
          costScalingMode: "per_output_unit",
          crewSize: "2.00",
          plannedMinutes: "15.0000",
        },
      ],
    });
    expect(product.status).toBe(201);
    const productId = product.body.id as string;

    const [bomOperationCostRow] = await db
      .select({
        costScalingMode: bomRevisionOperationCosts.costScalingMode,
        crewSize: bomRevisionOperationCosts.crewSize,
        plannedMinutes: bomRevisionOperationCosts.plannedMinutes,
        loadedCostPerHour: bomRevisionOperationCosts.loadedCostPerHour,
        plannedCostTotal: bomRevisionOperationCosts.plannedCostTotal,
      })
      .from(bomRevisionOperationCosts)
      .innerJoin(
        bomRevisions,
        eq(bomRevisions.id, bomRevisionOperationCosts.bomRevisionId)
      )
      .where(eq(bomRevisions.productId, productId));
    expect(bomOperationCostRow).toMatchObject({
      costScalingMode: "per_output_unit",
      crewSize: "2.0000",
      plannedMinutes: "15.0000",
      loadedCostPerHour: "30.000000",
      plannedCostTotal: "15.000000",
    });

    const order = await createManufacturingOrder({
      productId,
      plannedQuantity: "4",
      ingredients: [{ itemId: materialId, quantityPerUnit: "2" }],
      confirmShortage: false,
    });
    expect(order.status).toBe(201);
    const directOrderId = order.body.id as string;

    const operationCostRows = await db
      .select({
        operationName: manufacturingOrderOperationCosts.operationName,
        costScalingMode: manufacturingOrderOperationCosts.costScalingMode,
        crewSize: manufacturingOrderOperationCosts.crewSize,
        plannedMinutes: manufacturingOrderOperationCosts.plannedMinutes,
        loadedCostPerHour: manufacturingOrderOperationCosts.loadedCostPerHour,
        plannedCostTotal: manufacturingOrderOperationCosts.plannedCostTotal,
      })
      .from(manufacturingOrderOperationCosts)
      .where(eq(manufacturingOrderOperationCosts.manufacturingOrderId, directOrderId));
    expect(operationCostRows).toEqual([
      {
        operationName: "Direct output crew",
        costScalingMode: "per_output_unit",
        crewSize: "2.0000",
        plannedMinutes: "15.0000",
        loadedCostPerHour: "30.000000",
        plannedCostTotal: "60.000000",
      },
    ]);

    const deleteResource = await testFetch("/api/manufacturing-resources", {
      method: "DELETE",
      body: JSON.stringify({ ids: [resourceId] }),
    });
    expect(deleteResource.status).toBe(409);
    const deleteResourceBody = await deleteResource.json();
    expect(deleteResourceBody.error).toContain("BOM operation cost line");
    expect(deleteResourceBody.error).toContain("manufacturing order snapshot");

    const [ingredient] = await db
      .select({ id: manufacturingOrderIngredients.id })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, directOrderId));
    expect(ingredient).toBeTruthy();

    const pickResponse = await testFetch(
      `/api/manufacturing-orders/${directOrderId}/ingredients/${ingredient.id}/pick`,
      { method: "POST" }
    );
    expect(pickResponse.status).toBe(200);

    const complete = await completeManufacturingOrder(directOrderId, "4");
    expect(complete.status).toBe(200);

    const [completedOrder] = await db
      .select({
        actualMaterialCost: manufacturingOrders.actualMaterialCost,
        actualOperationsCost: manufacturingOrders.actualOperationsCost,
        actualCostPerUnit: manufacturingOrders.actualCostPerUnit,
      })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, directOrderId));
    expect(Number.parseFloat(completedOrder.actualMaterialCost ?? "0")).toBeCloseTo(16, 6);
    expect(Number.parseFloat(completedOrder.actualOperationsCost ?? "0")).toBeCloseTo(60, 6);
    expect(Number.parseFloat(completedOrder.actualCostPerUnit ?? "0")).toBeCloseTo(19, 6);

    const outputRows = await db
      .select({
        id: manufacturingOrderOutputs.id,
        manufacturingOrderBatchId: manufacturingOrderOutputs.manufacturingOrderBatchId,
        lotId: manufacturingOrderOutputs.lotId,
        quantity: manufacturingOrderOutputs.quantity,
      })
      .from(manufacturingOrderOutputs)
      .where(eq(manufacturingOrderOutputs.manufacturingOrderId, directOrderId));
    expect(outputRows).toHaveLength(1);
    expect(outputRows[0]).toMatchObject({
      manufacturingOrderBatchId: null,
      quantity: "4.0000",
    });
    expect(outputRows[0].lotId).toBeTruthy();

    const outputConsumptions = await db
      .select()
      .from(manufacturingOrderOutputConsumptions)
      .where(
        eq(
          manufacturingOrderOutputConsumptions.manufacturingOrderOutputId,
          outputRows[0].id
        )
      );
    expect(outputConsumptions).toHaveLength(1);
    expect(outputConsumptions[0].quantityUsed).toBe("8.0000");

    const producedLots = await db
      .select({ id: lots.id, quantity: lots.quantity })
      .from(lots)
      .where(eq(lots.itemId, productId));
    expect(producedLots).toEqual([
      {
        id: outputRows[0].lotId,
        quantity: "4.0000",
      },
    ]);

    const outputEvents = await db
      .select({
        itemId: inventoryEvents.itemId,
        lotId: inventoryEvents.lotId,
        quantity: inventoryEvents.quantity,
      })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.referenceType, "manufacturing_order"),
          eq(inventoryEvents.referenceId, directOrderId),
          eq(inventoryEvents.eventType, "manufacturing_output")
        )
      );
    expect(outputEvents).toEqual([
      {
        itemId: productId,
        lotId: outputRows[0].lotId,
        quantity: "4.0000",
      },
    ]);
  });

  test("allocates fixed operation cost incrementally across partial outputs", async ({
    db,
  }) => {
    const fixedTs = Date.now();
    const material = await createItem({
      name: `Fast Fixed Output Material ${fixedTs}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-FIXED-OUTPUT-MAT-${fixedTs}`,
      category: `Fast Fixed Output ${fixedTs}`,
      description: "Material for fixed operation output coverage",
      defaultPurchasePrice: "1.00",
      defaultSellingPrice: null,
      stock: "30",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);
    const materialId = material.body.id as string;

    const resource = await testFetch("/api/manufacturing-resources", {
      method: "POST",
      body: JSON.stringify({
        name: `Fast Fixed Output Crew ${fixedTs}`,
        description: null,
        resourceType: "labor",
        loadedCostPerHour: "100",
      }),
    });
    expect(resource.status).toBe(201);
    const resourceBody = await resource.json();
    const resourceId = resourceBody.id as string;

    const product = await createItem({
      name: `Fast Fixed Output Product ${fixedTs}`,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `FAST-FIXED-OUTPUT-PRODUCT-${fixedTs}`,
      category: `Fast Fixed Output ${fixedTs}`,
      description: "Product for fixed operation output coverage",
      defaultPurchasePrice: null,
      defaultSellingPrice: "20.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: materialId, quantity: "1" }],
      standardCostQuantity: "10",
      operationCosts: [
        {
          operationName: "Fixed setup crew",
          resourceId,
          costScalingMode: "fixed_per_mo",
          crewSize: "1",
          plannedMinutes: "60",
        },
      ],
    });
    expect(product.status).toBe(201);
    const productId = product.body.id as string;

    const order = await createManufacturingOrder({
      productId,
      plannedQuantity: "10",
      ingredients: [{ itemId: materialId, quantityPerUnit: "1" }],
      confirmShortage: false,
    });
    expect(order.status).toBe(201);
    const orderId = order.body.id as string;

    for (const quantity of ["5", "5", "5"]) {
      const outputResponse = await testFetch(`/api/manufacturing-orders/${orderId}/outputs`, {
        method: "POST",
        body: JSON.stringify({
          quantity,
          outputDisposition: "available",
          notes: null,
          confirmNegativeStock: false,
        }),
      });
      expect(outputResponse.status).toBe(200);
    }

    const lotCosts = await db
      .select({
        quantity: inventoryLotBalances.quantity,
        unitCost: inventoryLotBalances.unitCost,
        receivedAt: inventoryLotBalances.receivedAt,
        lotId: inventoryLotBalances.lotId,
      })
      .from(inventoryLotBalances)
      .where(eq(inventoryLotBalances.itemId, productId))
      .orderBy(asc(inventoryLotBalances.receivedAt), asc(inventoryLotBalances.lotId));
    expect(lotCosts).toHaveLength(1);
    expect(lotCosts[0].quantity).toBe("15.0000");
    expect(Number.parseFloat(lotCosts[0].unitCost ?? "0")).toBeCloseTo(115 / 15, 6);

    const [completedOrder] = await db
      .select({
        actualMaterialCost: manufacturingOrders.actualMaterialCost,
        actualOperationsCost: manufacturingOrders.actualOperationsCost,
        actualCostPerUnit: manufacturingOrders.actualCostPerUnit,
      })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, orderId));
    expect(Number.parseFloat(completedOrder.actualMaterialCost ?? "0")).toBeCloseTo(15, 6);
    expect(Number.parseFloat(completedOrder.actualOperationsCost ?? "0")).toBeCloseTo(100, 6);
    expect(Number.parseFloat(completedOrder.actualCostPerUnit ?? "0")).toBeCloseTo(115 / 15, 4);
  });

  test("absorbs full fixed operation cost when final output is below plan", async ({
    db,
  }) => {
    const underYieldTs = Date.now();
    const material = await createItem({
      name: `Fast Fixed Under Yield Material ${underYieldTs}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-FIXED-UNDER-YIELD-MAT-${underYieldTs}`,
      category: `Fast Fixed Under Yield ${underYieldTs}`,
      description: "Material for fixed under-yield operation coverage",
      defaultPurchasePrice: "1.00",
      defaultSellingPrice: null,
      stock: "20",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);
    const materialId = material.body.id as string;

    const resource = await testFetch("/api/manufacturing-resources", {
      method: "POST",
      body: JSON.stringify({
        name: `Fast Fixed Under Yield Crew ${underYieldTs}`,
        description: null,
        resourceType: "labor",
        loadedCostPerHour: "100",
      }),
    });
    expect(resource.status).toBe(201);
    const resourceBody = await resource.json();
    const resourceId = resourceBody.id as string;

    const product = await createItem({
      name: `Fast Fixed Under Yield Product ${underYieldTs}`,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `FAST-FIXED-UNDER-YIELD-PRODUCT-${underYieldTs}`,
      category: `Fast Fixed Under Yield ${underYieldTs}`,
      description: "Product for fixed under-yield operation coverage",
      defaultPurchasePrice: null,
      defaultSellingPrice: "30.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: materialId, quantity: "1" }],
      standardCostQuantity: "10",
      operationCosts: [
        {
          operationName: "Fixed under-yield setup",
          resourceId,
          costScalingMode: "fixed_per_mo",
          crewSize: "1",
          plannedMinutes: "60",
        },
      ],
    });
    expect(product.status).toBe(201);
    const productId = product.body.id as string;

    const order = await createManufacturingOrder({
      productId,
      plannedQuantity: "10",
      ingredients: [{ itemId: materialId, quantityPerUnit: "1" }],
      confirmShortage: false,
    });
    expect(order.status).toBe(201);
    const orderId = order.body.id as string;

    const [ingredient] = await db
      .select({ id: manufacturingOrderIngredients.id })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, orderId));
    expect(ingredient).toBeTruthy();

    const pickResponse = await testFetch(
      `/api/manufacturing-orders/${orderId}/ingredients/${ingredient.id}/pick`,
      { method: "POST" }
    );
    expect(pickResponse.status).toBe(200);

    const complete = await completeManufacturingOrder(orderId, "8");
    expect(complete.status).toBe(200);

    const [completedOrder] = await db
      .select({
        actualMaterialCost: manufacturingOrders.actualMaterialCost,
        actualOperationsCost: manufacturingOrders.actualOperationsCost,
        actualCostPerUnit: manufacturingOrders.actualCostPerUnit,
      })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, orderId));

    expect(Number.parseFloat(completedOrder.actualMaterialCost ?? "0")).toBeCloseTo(10, 6);
    expect(Number.parseFloat(completedOrder.actualOperationsCost ?? "0")).toBeCloseTo(100, 6);
    expect(Number.parseFloat(completedOrder.actualCostPerUnit ?? "0")).toBeCloseTo(110 / 8, 6);
  });

  test("preserves operation rate snapshots when unrelated BOM edits create revisions", async ({
    db,
  }) => {
    const rateTs = Date.now();
    const materialA = await createItem({
      name: `Fast Rate Snapshot Material A ${rateTs}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-RATE-SNAPSHOT-MAT-A-${rateTs}`,
      category: `Fast Rate Snapshot ${rateTs}`,
      description: "Original material for operation rate snapshot coverage",
      defaultPurchasePrice: "1.00",
      defaultSellingPrice: null,
      stock: "10",
      safetyStock: "0",
      bom: [],
    });
    expect(materialA.status).toBe(201);
    const materialAId = materialA.body.id as string;

    const materialB = await createItem({
      name: `Fast Rate Snapshot Material B ${rateTs}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-RATE-SNAPSHOT-MAT-B-${rateTs}`,
      category: `Fast Rate Snapshot ${rateTs}`,
      description: "Replacement material for operation rate snapshot coverage",
      defaultPurchasePrice: "1.00",
      defaultSellingPrice: null,
      stock: "10",
      safetyStock: "0",
      bom: [],
    });
    expect(materialB.status).toBe(201);
    const materialBId = materialB.body.id as string;

    const resource = await testFetch("/api/manufacturing-resources", {
      method: "POST",
      body: JSON.stringify({
        name: `Fast Rate Snapshot Crew ${rateTs}`,
        description: null,
        resourceType: "labor",
        loadedCostPerHour: "30",
      }),
    });
    expect(resource.status).toBe(201);
    const resourceBody = await resource.json();
    const resourceId = resourceBody.id as string;

    const product = await createItem({
      name: `Fast Rate Snapshot Product ${rateTs}`,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `FAST-RATE-SNAPSHOT-PRODUCT-${rateTs}`,
      category: `Fast Rate Snapshot ${rateTs}`,
      description: "Product for operation rate snapshot coverage",
      defaultPurchasePrice: null,
      defaultSellingPrice: "10.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: materialAId, quantity: "1" }],
      operationCosts: [
        {
          operationName: "Snapshot crew",
          resourceId,
          costScalingMode: "per_output_unit",
          crewSize: "1",
          plannedMinutes: "60",
        },
      ],
    });
    expect(product.status).toBe(201);
    const productId = product.body.id as string;

    const updateResource = await testFetch(`/api/manufacturing-resources/${resourceId}`, {
      method: "PUT",
      body: JSON.stringify({
        name: `Fast Rate Snapshot Crew ${rateTs}`,
        description: null,
        resourceType: "labor",
        loadedCostPerHour: "45",
      }),
    });
    expect(updateResource.status).toBe(200);

    const updateProduct = await updateItem(productId, {
      name: `Fast Rate Snapshot Product ${rateTs}`,
      sku: `FAST-RATE-SNAPSHOT-PRODUCT-${rateTs}`,
      category: `Fast Rate Snapshot ${rateTs}`,
      description: "Product for operation rate snapshot coverage",
      defaultPurchasePrice: null,
      defaultSellingPrice: "10.00",
      sellable: false,
      safetyStock: "0",
      manufacturingMode: "discrete",
      expectedBatchYield: null,
      typicalBatchSize: null,
      typicalGroupSize: null,
      standardCostQuantity: null,
      bom: [{ componentId: materialBId, quantity: "1" }],
      operationCosts: [
        {
          operationName: "Snapshot crew",
          resourceId,
          costScalingMode: "per_output_unit",
          crewSize: "1",
          plannedMinutes: "60",
          loadedCostPerHour: "30",
        },
      ],
      revisionNote: "Swap material only",
    });
    expect(updateProduct.status).toBe(200);

    const operationRows = await db
      .select({
        revisionNumber: bomRevisions.revisionNumber,
        loadedCostPerHour: bomRevisionOperationCosts.loadedCostPerHour,
        plannedCostTotal: bomRevisionOperationCosts.plannedCostTotal,
      })
      .from(bomRevisionOperationCosts)
      .innerJoin(
        bomRevisions,
        eq(bomRevisions.id, bomRevisionOperationCosts.bomRevisionId)
      )
      .where(eq(bomRevisions.productId, productId))
      .orderBy(asc(bomRevisions.revisionNumber));

    expect(operationRows).toEqual([
      {
        revisionNumber: 1,
        loadedCostPerHour: "30.000000",
        plannedCostTotal: "30.000000",
      },
      {
        revisionNumber: 2,
        loadedCostPerHour: "30.000000",
        plannedCostTotal: "30.000000",
      },
    ]);
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

    await page.getByLabel("Batches").fill("3");
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

    // Execution moved into the redesigned sheet's overflow menu.
    await page.getByRole("button", { name: "More actions" }).click();
    await expect(
      page.getByRole("menuitem", { name: "Open execution" })
    ).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Escape");

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

    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Open execution" }).click();
    await page.waitForURL(`**/manufacturing/orders/${batchOrderId}/execute`);

    const runBatch = async (
      output: string,
      expectedActual: string,
      expectedExpected: string,
      options: { pickBeforeComplete?: boolean } = {}
    ) => {
      const pickBeforeComplete = options.pickBeforeComplete ?? true;
      const [startBatchResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            response
              .url()
              .includes(`/api/manufacturing-orders/${batchOrderId}/batches/`) &&
            response.url().endsWith("/start")
        ),
        page.getByRole("button", { name: "Start Batch" }).click(),
      ]);
      expect(startBatchResponse.status()).toBe(200);

      const sandCard = page
        .locator('[data-slot="card"]')
        .filter({ hasText: batchSandName })
        .first();
      const compostCard = page
        .locator('[data-slot="card"]')
        .filter({ hasText: batchCompostName })
        .first();

      if (pickBeforeComplete) {
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
      }

      await page.reload();
      await expect(page.getByRole("button", { name: "Complete Batch" })).toBeEnabled();
      if (pickBeforeComplete) {
        await page.getByRole("button", { name: "Complete Batch" }).click();
      } else {
        const [pickRemainingResponse] = await Promise.all([
          page.waitForResponse(
            (response) =>
              response.request().method() === "POST" &&
              response
                .url()
                .endsWith(
                  `/api/manufacturing-orders/${batchOrderId}/ingredients/pick-remaining`
                )
          ),
          page.getByRole("button", { name: "Complete Batch" }).click(),
        ]);
        expect(pickRemainingResponse.status()).toBe(200);
      }
      await expect(page.getByLabel("Actual Output")).toBeVisible({ timeout: 15_000 });
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

    await runBatch("2", "2.0000", "4.0000", { pickBeforeComplete: false });
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

    const outputRows = await db
      .select({
        id: manufacturingOrderOutputs.id,
        manufacturingOrderBatchId: manufacturingOrderOutputs.manufacturingOrderBatchId,
        lotId: manufacturingOrderOutputs.lotId,
        quantity: manufacturingOrderOutputs.quantity,
      })
      .from(manufacturingOrderOutputs)
      .where(eq(manufacturingOrderOutputs.manufacturingOrderId, batchOrderId))
      .orderBy(asc(manufacturingOrderOutputs.outputNumber));
    expect(outputRows).toHaveLength(3);
    expect(outputRows.map((output) => output.quantity)).toEqual([
      "2.0000",
      "1.5000",
      "2.2000",
    ]);
    expect(outputRows.map((output) => output.manufacturingOrderBatchId).sort()).toEqual(
      completedBatches.map((batch) => batch.id).sort()
    );
    expect(outputRows.map((output) => output.lotId).sort()).toEqual(
      producedLots.map((lot) => lot.id).sort()
    );

    const outputConsumptions = await db
      .select()
      .from(manufacturingOrderOutputConsumptions)
      .where(
        inArray(
          manufacturingOrderOutputConsumptions.manufacturingOrderOutputId,
          outputRows.map((output) => output.id)
        )
      );
    expect(outputConsumptions).toHaveLength(6);

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
    page,
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
      sellable: true,
      stock: "0",
      safetyStock: "0",
      bom: [
        {
          componentId: legacySandCreate.body.id as string,
          quantity: "3",
          consumptionMode: "per_batch",
          basisOutputQuantity: "2",
          batchScalingMode: "full_batches_only",
        },
        {
          componentId: legacyCompostCreate.body.id as string,
          quantity: "1",
          consumptionMode: "per_batch",
          basisOutputQuantity: "2",
          batchScalingMode: "full_batches_only",
        },
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
    expect(
      createdIngredients.every((ingredient) => ingredient.manufacturingOrderBatchId != null)
    ).toBe(true);

    // /edit redirects into the inline-editable detail sheet; ingredients
    // render in the Ingredients table rather than a legacy edit form.
    await page.goto(`/manufacturing/orders/${legacyOrderId}/edit`);
    await page.waitForURL(`**/manufacturing/orders/${legacyOrderId}`);
    await expect(page.getByRole("heading", { name: "Order details" })).toBeVisible();
    await expect(page.getByText(`Legacy Batch Sand ${legacyTs}`)).toBeVisible();
    await expect(page.getByText(`Legacy Batch Compost ${legacyTs}`)).toBeVisible();

    const customerResponse = await testFetch("/api/customers", {
      method: "POST",
      body: JSON.stringify({
        name: `Legacy Batch Customer ${legacyTs}`,
        email: null,
        phone: null,
        notes: null,
      }),
    });
    expect(customerResponse.status).toBe(201);
    const customerBody = await customerResponse.json();
    const salesOrderResponse = await testFetch("/api/sales-orders", {
      method: "POST",
      body: JSON.stringify({
        customerId: customerBody.id,
        status: "open",
        orderDate: "2026-04-25",
        shipDate: "2026-04-25",
        requestedDate: "2026-04-25",
        notes: null,
        confirmOversell: true,
        lines: [
          {
            itemId: legacyProductCreate.body.id,
            quantity: "5",
            unitPrice: "60.00",
          },
        ],
      }),
    });
    expect(salesOrderResponse.status).toBe(201);
    const salesOrderBody = await salesOrderResponse.json();
    const [salesOrderLine] = await db
      .select({
        id: salesOrderLines.id,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, salesOrderBody.id as string));
    expect(salesOrderLine).toBeTruthy();

    const editableIngredients = [
      createdIngredients.find((ingredient) => ingredient.sortOrder === 0),
      createdIngredients.find((ingredient) => ingredient.sortOrder === 1),
    ];
    if (!editableIngredients[0] || !editableIngredients[1]) {
      throw new Error("Expected editable batch ingredient rows.");
    }
    const [firstEditableIngredient, secondEditableIngredient] = editableIngredients;

    const updateResponse = await testFetch(`/api/manufacturing-orders/${legacyOrderId}`, {
      method: "PUT",
      body: JSON.stringify({
        salesOrderId: salesOrderBody.id,
        salesOrderLineId: salesOrderLine.id,
        plannedQuantity: "5",
        plannedDate: null,
        notes: "Open batch linked from edit",
        groupRemainderChoices: [],
        ingredients: [firstEditableIngredient, secondEditableIngredient].map((ingredient) => ({
          itemId: ingredient.itemId,
          quantityPerUnit: String(parseFloat(ingredient.quantityPerUnit)),
        })),
      }),
    });
    const updateBody = await updateResponse.json().catch(() => null);
    expect(updateResponse.status, JSON.stringify(updateBody)).toBe(200);

    const [linkedLegacyOrder] = await db
      .select({
        salesOrderId: manufacturingOrders.salesOrderId,
        salesOrderLineId: manufacturingOrders.salesOrderLineId,
      })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, legacyOrderId));
    expect(linkedLegacyOrder.salesOrderId).toBe(salesOrderBody.id);
    expect(linkedLegacyOrder.salesOrderLineId).toBe(salesOrderLine.id);

    const linkedIngredients = await db
      .select()
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, legacyOrderId));
    expect(linkedIngredients).toHaveLength(6);
    expect(
      linkedIngredients.every((ingredient) => ingredient.manufacturingOrderBatchId != null)
    ).toBe(true);

    const draftTemplateIngredients = [
      linkedIngredients.find((ingredient) => ingredient.sortOrder === 0),
      linkedIngredients.find((ingredient) => ingredient.sortOrder === 1),
    ];
    if (!draftTemplateIngredients[0] || !draftTemplateIngredients[1]) {
      throw new Error("Expected batch ingredients to seed legacy template rows.");
    }
    const templateIngredients = [
      draftTemplateIngredients[0],
      draftTemplateIngredients[1],
    ];

    await page.close();

    await db
      .delete(manufacturingOrderBatches)
      .where(eq(manufacturingOrderBatches.manufacturingOrderId, legacyOrderId));
    await db
      .delete(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, legacyOrderId));

    await db.insert(manufacturingOrderIngredients).values(
      templateIngredients.map((ingredient) => ({
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
      .select({ id: manufacturingOrderBatches.id })
      .from(manufacturingOrderBatches)
      .where(eq(manufacturingOrderBatches.manufacturingOrderId, legacyOrderId))
      .orderBy(
        asc(manufacturingOrderBatches.batchNumber),
        asc(manufacturingOrderBatches.id)
      );
    const beforeReadBatchIds = beforeReadBatches.map((batch) => batch.id).sort();

    const beforeReadIngredients = await db
      .select({
        id: manufacturingOrderIngredients.id,
        manufacturingOrderBatchId: manufacturingOrderIngredients.manufacturingOrderBatchId,
      })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, legacyOrderId))
      .orderBy(
        asc(manufacturingOrderIngredients.sortOrder),
        asc(manufacturingOrderIngredients.id)
      );
    const beforeReadIngredientShape = beforeReadIngredients.map((ingredient) => ({
      id: ingredient.id,
      manufacturingOrderBatchId: ingredient.manufacturingOrderBatchId,
    }));

    const executionResponse = await testFetch(
      `/api/manufacturing-orders/${legacyOrderId}/execution`
    );
    expect(executionResponse.status).toBe(200);

    const afterReadBatches = await db
      .select({ id: manufacturingOrderBatches.id })
      .from(manufacturingOrderBatches)
      .where(eq(manufacturingOrderBatches.manufacturingOrderId, legacyOrderId))
      .orderBy(
        asc(manufacturingOrderBatches.batchNumber),
        asc(manufacturingOrderBatches.id)
      );
    expect(afterReadBatches.map((batch) => batch.id).sort()).toEqual(
      beforeReadBatchIds
    );

    const afterReadTemplateIngredients = await db
      .select({
        id: manufacturingOrderIngredients.id,
        manufacturingOrderBatchId: manufacturingOrderIngredients.manufacturingOrderBatchId,
      })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, legacyOrderId))
      .orderBy(
        asc(manufacturingOrderIngredients.sortOrder),
        asc(manufacturingOrderIngredients.id)
      );
    expect(
      afterReadTemplateIngredients.map((ingredient) => ({
        id: ingredient.id,
        manufacturingOrderBatchId: ingredient.manufacturingOrderBatchId,
      }))
    ).toEqual(beforeReadIngredientShape);
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
    expect(deleteResponse.status, JSON.stringify(deleteBody)).toBe(200);

    const [deletedOrder] = await db
      .select({ deletedAt: manufacturingOrders.deletedAt })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, alternateOrderId));
    expect(deletedOrder.deletedAt).toBeTruthy();

    const [alternateBalance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, alternateMaterial.body.id));
    expect(alternateBalance?.onHandQty).toBe("20.0000");
  });
});
