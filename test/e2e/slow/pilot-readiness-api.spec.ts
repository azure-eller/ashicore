import { and, asc, eq, sql } from "drizzle-orm";
import { test, expect, type TestDb } from "../fixtures";
import {
  customers,
  inventoryEvents,
  inventoryItemBalances,
  inventoryLotBalances,
  lots,
  manufacturingOrderBatches,
  manufacturingOrderIngredients,
  manufacturingOrders,
  manufacturingPickAllocations,
  salesOrderLines,
  salesOrders,
  stocktakeItems,
  stocktakes,
} from "../../../lib/db/schema";
import {
  createCustomer,
  createItem,
  createManufacturingOrder,
  createSalesOrder,
  getOrgId,
  getUnitId,
  testFetch,
} from "../../helpers/api";
import { capturePilotEvidence } from "../../helpers/evidence-screenshots";

type TestResponseBody = Record<string, unknown> | null;

async function jsonBody(response: { json(): Promise<unknown> }) {
  return response.json().catch(() => null) as Promise<TestResponseBody>;
}

async function postJsonWithKey(path: string, idempotencyKey: string, body?: unknown) {
  return testFetch(path, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: body == null ? undefined : JSON.stringify(body),
  });
}

async function firstAvailableLotId(db: TestDb, itemId: string) {
  const [row] = await db
    .select({ lotId: inventoryLotBalances.lotId })
    .from(inventoryLotBalances)
    .where(
      and(
        eq(inventoryLotBalances.itemId, itemId),
        eq(inventoryLotBalances.disposition, "available"),
        sql`${inventoryLotBalances.quantity} > 0`
      )
    )
    .limit(1);

  if (!row) {
    throw new Error(`Missing available lot for ${itemId}`);
  }

  return row.lotId;
}

async function changeDisposition(params: {
  itemId: string;
  lotId: string;
  action: "block" | "release" | "reject" | "scrap";
  fromDisposition: "available" | "blocked" | "rejected";
  quantity: string;
}) {
  const response = await testFetch(
    `/api/items/${params.itemId}/lots/${params.lotId}/disposition`,
    {
      method: "POST",
      body: JSON.stringify({
        action: params.action,
        fromDisposition: params.fromDisposition,
        quantity: params.quantity,
        notes: null,
      }),
    }
  );
  return { status: response.status, body: await jsonBody(response) };
}

test.describe("ERP-36 pilot readiness web/API evidence", () => {
  test.describe.configure({ mode: "serial" });

  test("guards stocktake API negatives, terminal states, and available-only counts", async ({
    page,
    db,
  }) => {
    const ts = Date.now();
    const unitId = getUnitId();
    const category = `Pilot Stocktake ${ts}`;
    const materialName = `Pilot Count Material ${ts}`;

    const material = await createItem({
      name: materialName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `PILOT-STK-${ts}`,
      category,
      description: "Pilot stocktake API fixture",
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "10",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);
    const materialId = material.body.id as string;

    const lotId = await firstAvailableLotId(db, materialId);
    const blocked = await changeDisposition({
      itemId: materialId,
      lotId,
      action: "block",
      fromDisposition: "available",
      quantity: "4",
    });
    expect(blocked.status).toBe(200);

    const invalidScope = await testFetch("/api/stocktakes", {
      method: "POST",
      body: JSON.stringify({
        name: `Invalid Pilot Count ${ts}`,
        scope: "category:ambiguous",
        notes: null,
      }),
    });
    expect(invalidScope.status).toBe(400);
    expect(await jsonBody(invalidScope)).toMatchObject({
      errors: { scope: expect.any(Array) },
    });

    const created = await testFetch("/api/stocktakes", {
      method: "POST",
      body: JSON.stringify({
        name: `Pilot Count ${ts}`,
        scope: "material",
        notes: "ERP-36 evidence stocktake",
      }),
    });
    expect(created.status).toBe(201);
    const stocktakeId = ((await created.json()) as { id: string }).id;

    const [line] = await db
      .select()
      .from(stocktakeItems)
      .where(
        and(
          eq(stocktakeItems.stocktakeId, stocktakeId),
          eq(stocktakeItems.itemId, materialId)
        )
      );
    expect(line).toBeDefined();
    expect(line.expectedQty).toBe("6.0000");

    await page.goto(`/inventory/stocktakes/${stocktakeId}`);
    await expect(page.locator("main").getByText("Draft", { exact: true }).first()).toBeVisible();
    await capturePilotEvidence(page, `stocktake-draft-${ts}`);

    const duplicateLines = await testFetch(`/api/stocktakes/${stocktakeId}`, {
      method: "PUT",
      body: JSON.stringify({
        lines: [
          { lineId: line.id, countedQty: "6" },
          { lineId: line.id, countedQty: "6" },
        ],
      }),
    });
    expect(duplicateLines.status).toBe(400);

    for (const countedQty of ["-1", "abc"]) {
      const badCount = await testFetch(`/api/stocktakes/${stocktakeId}`, {
        method: "PUT",
        body: JSON.stringify({
          lines: [{ lineId: line.id, countedQty }],
        }),
      });
      expect(badCount.status).toBe(400);
      expect(await jsonBody(badCount)).toMatchObject({
        errors: { lines: expect.any(Array) },
      });
    }

    const noCountComplete = await testFetch(
      `/api/stocktakes/${stocktakeId}/complete`,
      {
        method: "POST",
        body: JSON.stringify({ confirmStale: false }),
      }
    );
    expect(noCountComplete.status).toBe(400);
    expect((await jsonBody(noCountComplete))?.error).toContain(
      "Enter at least one count"
    );

    const saved = await testFetch(`/api/stocktakes/${stocktakeId}`, {
      method: "PUT",
      body: JSON.stringify({
        lines: [{ lineId: line.id, countedQty: "6" }],
      }),
    });
    expect(saved.status).toBe(200);

    const completed = await testFetch(`/api/stocktakes/${stocktakeId}/complete`, {
      method: "POST",
      body: JSON.stringify({ confirmStale: false }),
    });
    expect(completed.status).toBe(200);

    await page.goto(`/inventory/stocktakes/${stocktakeId}`);
    await expect(
      page.locator("main").getByText("Completed", { exact: true }).first()
    ).toBeVisible();
    await capturePilotEvidence(page, `stocktake-completed-${ts}`);

    const terminalUpdate = await testFetch(`/api/stocktakes/${stocktakeId}`, {
      method: "PUT",
      body: JSON.stringify({
        lines: [{ lineId: line.id, countedQty: "5" }],
      }),
    });
    expect(terminalUpdate.status).toBe(400);

    const terminalComplete = await testFetch(
      `/api/stocktakes/${stocktakeId}/complete`,
      {
        method: "POST",
        body: JSON.stringify({ confirmStale: false }),
      }
    );
    expect(terminalComplete.status).toBe(400);

    const terminalCancel = await testFetch(`/api/stocktakes/${stocktakeId}/cancel`, {
      method: "POST",
    });
    expect(terminalCancel.status).toBe(400);

    const cancelCreated = await testFetch("/api/stocktakes", {
      method: "POST",
      body: JSON.stringify({
        name: `Pilot Cancelled Count ${ts}`,
        scope: "material",
        notes: null,
      }),
    });
    expect(cancelCreated.status).toBe(201);
    const cancelledStocktakeId = ((await cancelCreated.json()) as { id: string }).id;

    const cancelResponse = await testFetch(
      `/api/stocktakes/${cancelledStocktakeId}/cancel`,
      { method: "POST" }
    );
    expect(cancelResponse.status).toBe(200);

    const [cancelledLine] = await db
      .select({ id: stocktakeItems.id })
      .from(stocktakeItems)
      .where(eq(stocktakeItems.stocktakeId, cancelledStocktakeId))
      .limit(1);
    expect(cancelledLine).toBeDefined();

    const cancelledUpdate = await testFetch(
      `/api/stocktakes/${cancelledStocktakeId}`,
      {
        method: "PUT",
        body: JSON.stringify({
          lines: [{ lineId: cancelledLine.id, countedQty: "6" }],
        }),
      }
    );
    expect(cancelledUpdate.status).toBe(400);

    const cancelledComplete = await testFetch(
      `/api/stocktakes/${cancelledStocktakeId}/complete`,
      {
        method: "POST",
        body: JSON.stringify({ confirmStale: false }),
      }
    );
    expect(cancelledComplete.status).toBe(400);

    const cancelledCancel = await testFetch(
      `/api/stocktakes/${cancelledStocktakeId}/cancel`,
      { method: "POST" }
    );
    expect(cancelledCancel.status).toBe(400);

    const [completedStocktake] = await db
      .select()
      .from(stocktakes)
      .where(eq(stocktakes.id, stocktakeId));
    expect(completedStocktake.status).toBe("completed");
    expect(completedStocktake.organizationId).toBe(getOrgId());

    const [completedLine] = await db
      .select()
      .from(stocktakeItems)
      .where(eq(stocktakeItems.id, line.id));
    expect(completedLine.countedQty).toBe("6.0000");
    expect(completedLine.varianceQty).toBe("0.0000");
    expect(completedLine.appliedDeltaQty).toBe("0.0000");

    const [itemBalance] = await db
      .select()
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, materialId));
    expect(itemBalance.onHandQty).toBe("10.0000");
    expect(itemBalance.availableToPromise).toBe("6.0000");
    expect(itemBalance.lastVerifiedAt).toBeTruthy();

    const lotBalances = await db
      .select({
        disposition: inventoryLotBalances.disposition,
        quantity: inventoryLotBalances.quantity,
      })
      .from(inventoryLotBalances)
      .where(eq(inventoryLotBalances.itemId, materialId))
      .orderBy(asc(inventoryLotBalances.disposition));
    expect(lotBalances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ disposition: "available", quantity: "6.0000" }),
        expect.objectContaining({ disposition: "blocked", quantity: "4.0000" }),
      ])
    );

    const stocktakeEvents = await db
      .select({
        eventType: inventoryEvents.eventType,
        referenceType: inventoryEvents.referenceType,
        referenceId: inventoryEvents.referenceId,
        quantity: inventoryEvents.quantity,
      })
      .from(inventoryEvents)
      .where(sql`${inventoryEvents.metadata}->>'stocktakeId' = ${stocktakeId}`);
    expect(stocktakeEvents).toHaveLength(1);
    expect(stocktakeEvents[0]).toMatchObject({
      eventType: "stocktake_verification",
      referenceType: "stocktake_line",
      referenceId: line.id,
      quantity: "0.0000",
    });
  });

  test("guards manufacturing transitions, idempotent replay, blocked output, and mobile handoff contracts", async ({
    page,
    db,
  }) => {
    const ts = Date.now();
    const unitId = getUnitId();
    const category = `Pilot Manufacturing ${ts}`;

    const material = await createItem({
      name: `Pilot MO Material ${ts}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `PILOT-MO-MAT-${ts}`,
      category,
      description: "Pilot manufacturing material",
      defaultPurchasePrice: "3.00",
      defaultSellingPrice: null,
      stock: "50",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);
    const materialId = material.body.id as string;

    const productName = `Pilot MO Product ${ts}`;
    const product = await createItem({
      name: productName,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `PILOT-MO-PROD-${ts}`,
      category,
      description: "Pilot manufacturing product",
      defaultPurchasePrice: null,
      defaultSellingPrice: "25.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: materialId, quantity: "2" }],
    });
    expect(product.status).toBe(201);
    const productId = product.body.id as string;

    const customer = await createCustomer({ name: `Pilot MO Customer ${ts}` });
    expect(customer.status).toBe(201);
    const customerId = customer.body.id as string;

    const salesOrder = await createSalesOrder({
      customerId,
      requestedDate: "2026-05-20",
      notes: "ERP-36 linked manufacturing order",
      lines: [{ itemId: productId, quantity: "3", unitPrice: "25.00" }],
    });
    expect(salesOrder.status).toBe(201);
    const salesOrderId = salesOrder.body.id as string;

    const [salesLine] = await db
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, salesOrderId));
    expect(salesLine.itemId).toBe(productId);

    const confirmedSalesOrder = await testFetch(
      `/api/sales-orders/${salesOrderId}/confirm`,
      {
        method: "POST",
        body: JSON.stringify({ confirmOversell: true }),
      }
    );
    expect(confirmedSalesOrder.status).toBe(200);

    const linkedOrders = await testFetch(
      `/api/sales-orders/${salesOrderId}/manufacturing-orders`,
      {
        method: "POST",
        body: JSON.stringify({
          plannedDate: "2026-05-19",
          salesOrderLineIds: [salesLine.id],
          notes: "ERP-36 discrete execution evidence",
        }),
      }
    );
    expect(linkedOrders.status).toBe(201);
    const linkedOrdersBody = (await linkedOrders.json()) as {
      created: Array<{ manufacturingOrderId: string }>;
      skipped: Array<unknown>;
    };
    expect(linkedOrdersBody.skipped).toHaveLength(0);
    expect(linkedOrdersBody.created).toHaveLength(1);
    const orderId = linkedOrdersBody.created[0].manufacturingOrderId;

    const [linkedOrder] = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, orderId));
    expect(linkedOrder).toMatchObject({
      productId,
      salesOrderId,
      salesOrderLineId: salesLine.id,
      plannedQuantity: "3.0000",
    });

    const [draftIngredient] = await db
      .select()
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, orderId));
    expect(draftIngredient).toBeDefined();

    const completeDraft = await testFetch(
      `/api/manufacturing-orders/${orderId}/complete`,
      {
        method: "POST",
        body: JSON.stringify({ actualQuantity: "3" }),
      }
    );
    expect(completeDraft.status).toBe(400);

    const pickDraft = await testFetch(
      `/api/manufacturing-orders/${orderId}/ingredients/${draftIngredient.id}/pick`,
      { method: "POST" }
    );
    expect(pickDraft.status).toBe(400);

    const releaseKey = `pilot:${ts}:release`;
    const releaseOne = await postJsonWithKey(
      `/api/manufacturing-orders/${orderId}/release`,
      releaseKey,
      { confirmShortage: false }
    );
    expect(releaseOne.status).toBe(200);
    const releaseReplay = await postJsonWithKey(
      `/api/manufacturing-orders/${orderId}/release`,
      releaseKey,
      { confirmShortage: false }
    );
    expect(releaseReplay.status).toBe(200);

    const releaseAgain = await testFetch(
      `/api/manufacturing-orders/${orderId}/release`,
      {
        method: "POST",
        body: JSON.stringify({ confirmShortage: false }),
      }
    );
    expect(releaseAgain.status).toBe(400);

    const queueBeforePick = await testFetch("/api/manufacturing-execution/queue");
    expect(queueBeforePick.status).toBe(200);
    const queueBeforePickBody = (await queueBeforePick.json()) as Array<Record<string, unknown>>;
    expect(queueBeforePickBody).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: orderId,
          manufacturingMode: "discrete",
          pickProgressStatus: "not_started",
          nextBatchId: null,
          nextBatchNumber: null,
          actionLabel: "Pick",
        }),
      ])
    );

    const executionBeforePick = await testFetch(
      `/api/manufacturing-orders/${orderId}/execution`
    );
    expect(executionBeforePick.status).toBe(200);
    const executionBeforePickBody = (await executionBeforePick.json()) as Record<
      string,
      unknown
    >;
    expect(executionBeforePickBody).toMatchObject({
      id: orderId,
      salesOrderId,
      manufacturingMode: "discrete",
      canComplete: false,
      currentBatchId: null,
    });
    expect(executionBeforePickBody.ingredients).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: draftIngredient.id,
          itemId: materialId,
          plannedQuantity: "6",
          pickedQuantity: "0",
        }),
      ])
    );

    await page.goto(`/manufacturing/orders/${orderId}/execute`);
    await expect(page.getByText(productName)).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark Done", exact: true })).toBeVisible();
    await capturePilotEvidence(page, `manufacturing-execution-before-pick-${ts}`);

    const pickKey = `pilot:${ts}:pick`;
    const pickOne = await postJsonWithKey(
      `/api/manufacturing-orders/${orderId}/ingredients/${draftIngredient.id}/pick`,
      pickKey,
      {}
    );
    expect(pickOne.status).toBe(200);
    const pickReplay = await postJsonWithKey(
      `/api/manufacturing-orders/${orderId}/ingredients/${draftIngredient.id}/pick`,
      pickKey,
      {}
    );
    expect(pickReplay.status).toBe(200);

    const pickAgain = await testFetch(
      `/api/manufacturing-orders/${orderId}/ingredients/${draftIngredient.id}/pick`,
      { method: "POST" }
    );
    expect(pickAgain.status).toBe(400);

    const executionAfterPick = await testFetch(
      `/api/manufacturing-orders/${orderId}/execution`
    );
    expect(executionAfterPick.status).toBe(200);
    expect(await executionAfterPick.json()).toMatchObject({
      id: orderId,
      pickProgressStatus: "picked",
      canComplete: true,
    });

    await page.goto(`/manufacturing/orders/${orderId}/execute`);
    await expect(page.getByRole("button", { name: "Complete Order" })).toBeEnabled();
    await capturePilotEvidence(page, `manufacturing-execution-ready-${ts}`);

    const completeKey = `pilot:${ts}:complete`;
    const completeOne = await postJsonWithKey(
      `/api/manufacturing-orders/${orderId}/complete`,
      completeKey,
      {
        actualQuantity: "3",
        outputDisposition: "blocked",
        ingredientActuals: [
          { ingredientId: draftIngredient.id, actualConsumedQuantity: "6" },
        ],
      }
    );
    expect(completeOne.status).toBe(200);
    const completeReplay = await postJsonWithKey(
      `/api/manufacturing-orders/${orderId}/complete`,
      completeKey,
      {
        actualQuantity: "3",
        outputDisposition: "blocked",
        ingredientActuals: [
          { ingredientId: draftIngredient.id, actualConsumedQuantity: "6" },
        ],
      }
    );
    expect(completeReplay.status).toBe(200);

    const completeAgain = await testFetch(
      `/api/manufacturing-orders/${orderId}/complete`,
      {
        method: "POST",
        body: JSON.stringify({ actualQuantity: "3" }),
      }
    );
    expect(completeAgain.status).toBe(400);

    const cancelCompleted = await testFetch(
      `/api/manufacturing-orders/${orderId}/cancel`,
      { method: "POST" }
    );
    expect(cancelCompleted.status).toBe(400);

    await page.goto(`/manufacturing/orders/${orderId}`);
    await expect(
      page.locator("main").getByText("Completed", { exact: true }).first()
    ).toBeVisible();
    await capturePilotEvidence(page, `manufacturing-completed-blocked-${ts}`);

    const [completedOrder] = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, orderId));
    expect(completedOrder.status).toBe("completed");
    expect(completedOrder.salesOrderId).toBe(salesOrderId);
    expect(completedOrder.salesOrderLineId).toBe(salesLine.id);
    expect(completedOrder.actualQuantity).toBe("3.0000");

    const [salesOrderRow] = await db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.id, salesOrderId));
    expect(completedOrder.salesOrderNumber).toBe(salesOrderRow.orderNumber);

    const [customerRow] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, customerId));
    expect(completedOrder.salesCustomerName).toBe(customerRow.name);

    const [completedIngredient] = await db
      .select()
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.id, draftIngredient.id));
    expect(completedIngredient.pickedQuantity).toBe("6.0000");
    expect(completedIngredient.actualQuantity).toBe("6.0000");
    expect(completedIngredient.actualCostTotal).toBe("18.0000");

    const pickAllocations = await db
      .select()
      .from(manufacturingPickAllocations)
      .where(
        eq(
          manufacturingPickAllocations.manufacturingOrderIngredientId,
          draftIngredient.id
        )
      );
    expect(pickAllocations).toHaveLength(1);
    expect(pickAllocations[0].quantityUsed).toBe("6.0000");

    const producedLots = await db
      .select()
      .from(lots)
      .where(eq(lots.itemId, productId));
    expect(producedLots).toHaveLength(1);
    expect(producedLots[0].quantity).toBe("3.0000");

    const [productBalance] = await db
      .select()
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, productId));
    expect(productBalance.onHandQty).toBe("3.0000");
    expect(productBalance.expectedQty).toBe("0.0000");
    expect(productBalance.demandQty).toBe("3.0000");
    expect(productBalance.availableToPromise).toBe("-3.0000");

    const productLotBalances = await db
      .select()
      .from(inventoryLotBalances)
      .where(eq(inventoryLotBalances.itemId, productId));
    expect(productLotBalances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lotId: producedLots[0].id,
          disposition: "blocked",
          quantity: "3.0000",
        }),
      ])
    );
    expect(
      productLotBalances.find((row) => row.disposition === "available")?.quantity ??
        "0.0000"
    ).toBe("0.0000");

    const orderEvents = await db
      .select({
        eventType: inventoryEvents.eventType,
        disposition: inventoryEvents.disposition,
        referenceType: inventoryEvents.referenceType,
        referenceId: inventoryEvents.referenceId,
      })
      .from(inventoryEvents)
      .where(eq(inventoryEvents.referenceId, orderId));
    expect(
      orderEvents.filter((event) => event.eventType === "expected_increase")
    ).toHaveLength(1);
    expect(
      orderEvents.filter(
        (event) => event.eventType === "manufacturing_ingredient_consumption"
      )
    ).toHaveLength(1);
    expect(
      orderEvents.filter((event) => event.eventType === "manufacturing_output")
    ).toEqual([
      expect.objectContaining({
        disposition: "blocked",
        referenceType: "manufacturing_order",
        referenceId: orderId,
      }),
    ]);
    expect(
      orderEvents.filter((event) => event.eventType === "expected_release")
    ).toHaveLength(1);

    const cancelMaterial = await createItem({
      name: `Pilot Cancel Material ${ts}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `PILOT-CANCEL-MAT-${ts}`,
      category,
      description: "Pilot cancel material",
      defaultPurchasePrice: "1.00",
      defaultSellingPrice: null,
      stock: "8",
      safetyStock: "0",
      bom: [],
    });
    expect(cancelMaterial.status).toBe(201);

    const cancelProduct = await createItem({
      name: `Pilot Cancel Product ${ts}`,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `PILOT-CANCEL-PROD-${ts}`,
      category,
      description: "Pilot cancel product",
      defaultPurchasePrice: null,
      defaultSellingPrice: "10.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: cancelMaterial.body.id as string, quantity: "1" }],
    });
    expect(cancelProduct.status).toBe(201);

    const cancelOrder = await createManufacturingOrder({
      productId: cancelProduct.body.id as string,
      plannedQuantity: "2",
      ingredients: [
        { itemId: cancelMaterial.body.id as string, quantityPerUnit: "1" },
      ],
    });
    expect(cancelOrder.status).toBe(201);
    const cancelOrderId = cancelOrder.body.id as string;

    const cancelRelease = await testFetch(
      `/api/manufacturing-orders/${cancelOrderId}/release`,
      {
        method: "POST",
        body: JSON.stringify({ confirmShortage: false }),
      }
    );
    expect(cancelRelease.status).toBe(200);

    const cancelKey = `pilot:${ts}:cancel`;
    const cancelOne = await postJsonWithKey(
      `/api/manufacturing-orders/${cancelOrderId}/cancel`,
      cancelKey
    );
    expect(cancelOne.status).toBe(200);
    const cancelReplay = await postJsonWithKey(
      `/api/manufacturing-orders/${cancelOrderId}/cancel`,
      cancelKey
    );
    expect(cancelReplay.status).toBe(200);

    const [cancelledOrder] = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, cancelOrderId));
    expect(cancelledOrder.status).toBe("cancelled");

    const cancelEvents = await db
      .select({ eventType: inventoryEvents.eventType })
      .from(inventoryEvents)
      .where(eq(inventoryEvents.referenceId, cancelOrderId));
    expect(
      cancelEvents.filter((event) => event.eventType === "expected_increase")
    ).toHaveLength(1);
    expect(
      cancelEvents.filter((event) => event.eventType === "expected_release")
    ).toHaveLength(1);

    const batchMaterial = await createItem({
      name: `Pilot Batch Material ${ts}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `PILOT-BATCH-MAT-${ts}`,
      category,
      description: "Pilot batch material",
      defaultPurchasePrice: "1.50",
      defaultSellingPrice: null,
      stock: "20",
      safetyStock: "0",
      bom: [],
    });
    expect(batchMaterial.status).toBe(201);

    const batchProduct = await createItem({
      name: `Pilot Batch Product ${ts}`,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `PILOT-BATCH-PROD-${ts}`,
      category,
      description: "Pilot batch product",
      defaultPurchasePrice: null,
      defaultSellingPrice: "15.00",
      stock: "0",
      safetyStock: "0",
      manufacturingMode: "batch",
      expectedBatchYield: "2",
      bom: [{ componentId: batchMaterial.body.id as string, quantity: "1" }],
    });
    expect(batchProduct.status).toBe(201);

    const batchOrder = await createManufacturingOrder({
      productId: batchProduct.body.id as string,
      plannedQuantity: "4",
      ingredients: [
        { itemId: batchMaterial.body.id as string, quantityPerUnit: "1" },
      ],
    });
    expect(batchOrder.status).toBe(201);
    const batchOrderId = batchOrder.body.id as string;

    const batchRelease = await testFetch(
      `/api/manufacturing-orders/${batchOrderId}/release`,
      {
        method: "POST",
        body: JSON.stringify({ confirmShortage: false }),
      }
    );
    expect(batchRelease.status).toBe(200);

    const batches = await db
      .select()
      .from(manufacturingOrderBatches)
      .where(eq(manufacturingOrderBatches.manufacturingOrderId, batchOrderId))
      .orderBy(asc(manufacturingOrderBatches.batchNumber));
    expect(batches).toHaveLength(2);

    const queueWithBatch = await testFetch("/api/manufacturing-execution/queue");
    expect(queueWithBatch.status).toBe(200);
    expect(await queueWithBatch.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: batchOrderId,
          manufacturingMode: "batch",
          nextBatchId: batches[0].id,
          nextBatchNumber: 1,
          completedBatchCount: 0,
          totalBatchCount: 2,
          actionLabel: "Batch 1",
        }),
      ])
    );

    const batchExecution = await testFetch(
      `/api/manufacturing-orders/${batchOrderId}/execution`
    );
    expect(batchExecution.status).toBe(200);
    expect(await batchExecution.json()).toMatchObject({
      id: batchOrderId,
      manufacturingMode: "batch",
      currentBatchId: batches[0].id,
      currentBatch: expect.objectContaining({
        id: batches[0].id,
        batchNumber: 1,
        status: "pending",
      }),
      batches: [
        expect.objectContaining({ id: batches[0].id, batchNumber: 1 }),
        expect.objectContaining({ id: batches[1].id, batchNumber: 2 }),
      ],
    });
  });
});
