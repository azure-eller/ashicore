import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  inventoryEvents,
  inventoryItemBalances,
  inventoryLocations,
  inventoryLotBalances,
  inventoryReservationsSummary,
  bomRevisionComponents,
  bomRevisionOperationCosts,
  bomRevisions,
  itemFamilies,
  itemVariantValues,
  items,
  lots,
  manufacturingOrderIngredients,
  manufacturingOrders,
  manufacturingResources,
  stockAllocations,
  stocktakeItems,
  stocktakeLotItems,
  stocktakes,
  variantOptionValues,
  variantOptions,
} from "../../../lib/db/schema";
import {
  consumeStockFifoInTx,
  createPositiveStockEventInTx,
  INTERNAL_UNTRACKED_LOT_NUMBER,
} from "../../../lib/inventory/kernel";
import { buildStocktakeCategoryScope } from "../../../lib/schemas/stocktakes";
import { createItem, getOrgId, getUnitId, testFetch } from "../../helpers/api";

test.describe("inventory mutation kernel heartbeat", () => {
  const ts = Date.now();
  const orgId = getOrgId();
  const unitId = getUnitId();

  test("manual adjustment writes stock event and projection truth", async ({
    db,
  }) => {
    const item = await createItem({
      itemType: "material",
      name: `Fast Kernel Adjustment ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-KERNEL-ADJ-${ts}`,
      category: `Fast Kernel ${ts}`,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "1",
      safetyStock: "0",
      bom: [],
    });
    expect(item.status).toBe(201);
    const itemId = item.body.id as string;

    const response = await testFetch(`/api/items/${itemId}/stock-adjustments`, {
      method: "POST",
      body: JSON.stringify({
        quantity: "12",
        costPerUnit: "2.00",
        occurredAt: new Date().toISOString(),
        note: "fast heartbeat adjustment",
      }),
    });
    expect(response.status).toBe(200);

    const [event] = await db
      .select({
        eventType: inventoryEvents.eventType,
        quantity: inventoryEvents.quantity,
        lotId: inventoryEvents.lotId,
      })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, itemId),
          eq(inventoryEvents.eventType, "manual_adjustment_increase")
        )
      )
      .orderBy(desc(inventoryEvents.occurredAt), desc(inventoryEvents.id));

    expect(event).toMatchObject({
      eventType: "manual_adjustment_increase",
      quantity: "12.0000",
    });
    expect(event.lotId).toBeTruthy();

    const [lotBalance] = await db
      .select({
        quantity: sql<string>`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`,
      })
      .from(inventoryLotBalances)
      .where(eq(inventoryLotBalances.itemId, itemId));
    const [itemBalance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        availableToPromise: inventoryItemBalances.availableToPromise,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, itemId));

    expect(lotBalance.quantity).toBe("13.0000");
    expect(itemBalance).toMatchObject({
      onHandQty: "13.0000",
      availableToPromise: "13.0000",
    });
  });

  test("negative stock uses one debt lot and withholds receipts until debt clears", async ({
    db,
  }) => {
    const category = `Fast Negative Debt ${ts}`;
    const item = await createItem({
      itemType: "material",
      name: `Fast Negative Debt ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-NEG-DEBT-${ts}`,
      category,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(item.status).toBe(201);
    const itemId = item.body.id as string;

    const [location] = await db
      .select({ id: inventoryLocations.id })
      .from(inventoryLocations)
      .where(
        and(
          eq(inventoryLocations.organizationId, orgId),
          eq(inventoryLocations.isDefault, true)
        )
      );
    const locationId = location?.id;
    expect(locationId).toBeTruthy();
    if (!locationId) throw new Error("Default inventory location not found.");

    await db.transaction(async (tx) => {
      await consumeStockFifoInTx(tx, {
        organizationId: orgId,
        locationId,
        itemId,
        quantity: 4,
        eventType: "manual_adjustment_decrease",
        eventSubtype: "fast_negative_regression",
        referenceType: "item",
        referenceId: itemId,
        allowNegativeStock: true,
      });
      await consumeStockFifoInTx(tx, {
        organizationId: orgId,
        locationId,
        itemId,
        quantity: 6,
        eventType: "manual_adjustment_decrease",
        eventSubtype: "fast_negative_regression",
        referenceType: "item",
        referenceId: itemId,
        allowNegativeStock: true,
      });
    });

    let [itemBalance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        availableToPromise: inventoryItemBalances.availableToPromise,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, itemId));

    expect(itemBalance).toMatchObject({
      onHandQty: "-10.0000",
      availableToPromise: "0.0000",
    });

    await db.transaction(async (tx) => {
      await createPositiveStockEventInTx(tx, {
        organizationId: orgId,
        locationId,
        itemId,
        quantity: 5,
        unitCost: "2.00",
        eventType: "manual_adjustment_increase",
        eventSubtype: "fast_negative_regression",
        referenceType: "item",
        referenceId: itemId,
      });
      await consumeStockFifoInTx(tx, {
        organizationId: orgId,
        locationId,
        itemId,
        quantity: 8,
        eventType: "manual_adjustment_decrease",
        eventSubtype: "fast_negative_regression",
        referenceType: "item",
        referenceId: itemId,
        allowNegativeStock: true,
      });
      await createPositiveStockEventInTx(tx, {
        organizationId: orgId,
        locationId,
        itemId,
        quantity: 7,
        unitCost: "2.00",
        eventType: "manual_adjustment_increase",
        eventSubtype: "fast_negative_regression",
        referenceType: "item",
        referenceId: itemId,
      });
    });

    const lotRows = await db
      .select({
        lotNumber: lots.lotNumber,
        quantity: lots.quantity,
      })
      .from(lots)
      .where(eq(lots.itemId, itemId))
      .orderBy(lots.lotNumber);

    expect(
      lotRows.filter((lot) => lot.lotNumber === "UNBATCHED-NEGATIVE-STOCK")
    ).toEqual([expect.objectContaining({ quantity: "-13.0000" })]);
    expect(
      lotRows.filter((lot) => lot.lotNumber !== "UNBATCHED-NEGATIVE-STOCK")
    ).toHaveLength(2);
    expect(
      lotRows
        .filter((lot) => lot.lotNumber !== "UNBATCHED-NEGATIVE-STOCK")
        .reduce((sum, lot) => sum + Number(lot.quantity), 0)
    ).toBe(7);

    [itemBalance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        availableToPromise: inventoryItemBalances.availableToPromise,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, itemId));

    expect(itemBalance).toMatchObject({
      onHandQty: "-6.0000",
      availableToPromise: "0.0000",
    });

    const stocktakeResponse = await testFetch("/api/stocktakes", {
      method: "POST",
      body: JSON.stringify({
        name: `Fast Negative Debt Stocktake ${ts}`,
        scope: buildStocktakeCategoryScope("material", category),
        notes: null,
      }),
    });
    expect(stocktakeResponse.status).toBe(201);
    const stocktake = await stocktakeResponse.json();

    const [line] = await db
      .select({ id: stocktakeItems.id, expectedQty: stocktakeItems.expectedQty })
      .from(stocktakeItems)
      .where(
        and(
          eq(stocktakeItems.stocktakeId, stocktake.id),
          eq(stocktakeItems.itemId, itemId)
        )
      );
    expect(line).toBeTruthy();
    if (!line) throw new Error("Expected stocktake line was not created.");
    expect(line?.expectedQty).toBe("-6.0000");

    const stocktakeLotRows = await db
      .select({ id: stocktakeLotItems.id })
      .from(stocktakeLotItems)
      .where(eq(stocktakeLotItems.stocktakeItemId, line.id));
    expect(stocktakeLotRows).toEqual([]);

    await db.transaction(async (tx) => {
      await createPositiveStockEventInTx(tx, {
        organizationId: orgId,
        locationId,
        itemId,
        quantity: 10,
        unitCost: "2.00",
        eventType: "manual_adjustment_increase",
        eventSubtype: "fast_negative_regression",
        referenceType: "item",
        referenceId: itemId,
      });
    });

    [itemBalance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        availableToPromise: inventoryItemBalances.availableToPromise,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, itemId));

    expect(itemBalance).toMatchObject({
      onHandQty: "4.0000",
      availableToPromise: "4.0000",
    });
  });

  test("untracked stock uses one hidden internal lot even when negative", async ({
    db,
  }) => {
    const itemName = `Fast Untracked Internal Lot ${ts}`;
    const category = `Fast Untracked Internal ${ts}`;
    const item = await createItem({
      itemType: "material",
      name: itemName,
      unitDefinitionId: unitId,
      sku: `FAST-UNTRACKED-INT-${ts}`,
      category,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(item.status).toBe(201);
    const itemId = item.body.id as string;

    const modeResponse = await testFetch(`/api/item-cards/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: itemName,
        category,
        description: null,
        unitDefinitionId: unitId,
        lotTrackingMode: "untracked",
      }),
    });
    expect(
      modeResponse.status,
      JSON.stringify(await modeResponse.json().catch(() => null))
    ).toBe(200);

    const [location] = await db
      .select({ id: inventoryLocations.id })
      .from(inventoryLocations)
      .where(
        and(
          eq(inventoryLocations.organizationId, orgId),
          eq(inventoryLocations.isDefault, true)
        )
      );
    if (!location?.id) throw new Error("Default inventory location not found.");

    await db.transaction(async (tx) => {
      await createPositiveStockEventInTx(tx, {
        organizationId: orgId,
        locationId: location.id,
        itemId,
        quantity: 5,
        unitCost: "2.00",
        eventType: "manual_adjustment_increase",
        eventSubtype: "fast_untracked_internal",
        referenceType: "item",
        referenceId: itemId,
        metadata: {
          lotNumber: "SHOULD-NOT-LEAK",
          internalUntrackedLot: false,
        },
      });
      await createPositiveStockEventInTx(tx, {
        organizationId: orgId,
        locationId: location.id,
        itemId,
        quantity: 3,
        unitCost: "4.00",
        eventType: "manual_adjustment_increase",
        eventSubtype: "fast_untracked_internal",
        referenceType: "item",
        referenceId: itemId,
      });
      await consumeStockFifoInTx(tx, {
        organizationId: orgId,
        locationId: location.id,
        itemId,
        quantity: 10,
        eventType: "manual_adjustment_decrease",
        eventSubtype: "fast_untracked_internal",
        referenceType: "item",
        referenceId: itemId,
        allowNegativeStock: true,
      });
    });

    let lotRows = await db
      .select({
        id: lots.id,
        lotNumber: lots.lotNumber,
        quantity: lots.quantity,
      })
      .from(lots)
      .where(eq(lots.itemId, itemId));

    expect(lotRows).toEqual([
      expect.objectContaining({
        lotNumber: INTERNAL_UNTRACKED_LOT_NUMBER,
        quantity: "-2.0000",
      }),
    ]);

    let [itemBalance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        availableToPromise: inventoryItemBalances.availableToPromise,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, itemId));
    expect(itemBalance).toMatchObject({
      onHandQty: "-2.0000",
      availableToPromise: "0.0000",
    });

    const eventRows = await db
      .select({
        lotId: inventoryEvents.lotId,
        metadata: inventoryEvents.metadata,
      })
      .from(inventoryEvents)
      .where(eq(inventoryEvents.itemId, itemId));
    expect(eventRows).toHaveLength(3);
    expect(new Set(eventRows.map((event) => event.lotId))).toEqual(
      new Set([lotRows[0].id])
    );
    expect(eventRows.every((event) => event.metadata?.internalUntrackedLot === true)).toBe(
      true
    );
    expect(eventRows.some((event) => "lotNumber" in (event.metadata ?? {}))).toBe(false);

    await db.transaction(async (tx) => {
      await createPositiveStockEventInTx(tx, {
        organizationId: orgId,
        locationId: location.id,
        itemId,
        quantity: 5,
        unitCost: "3.00",
        eventType: "manual_adjustment_increase",
        eventSubtype: "fast_untracked_internal",
        referenceType: "item",
        referenceId: itemId,
      });
    });

    lotRows = await db
      .select({
        id: lots.id,
        lotNumber: lots.lotNumber,
        quantity: lots.quantity,
      })
      .from(lots)
      .where(eq(lots.itemId, itemId));
    expect(lotRows).toEqual([
      expect.objectContaining({
        lotNumber: INTERNAL_UNTRACKED_LOT_NUMBER,
        quantity: "3.0000",
      }),
    ]);

    [itemBalance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        availableToPromise: inventoryItemBalances.availableToPromise,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, itemId));
    expect(itemBalance).toMatchObject({
      onHandQty: "3.0000",
      availableToPromise: "3.0000",
    });
  });

  test("turning off lot tracking consolidates existing lots", async ({ db }) => {
    const itemName = `Fast Disable Lot Tracking ${ts}`;
    const category = `Fast Disable Lot Tracking ${ts}`;
    const item = await createItem({
      itemType: "material",
      name: itemName,
      unitDefinitionId: unitId,
      sku: `FAST-DISABLE-LOTS-${ts}`,
      category,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(item.status).toBe(201);
    const itemId = item.body.id as string;

    const [location] = await db
      .select({ id: inventoryLocations.id })
      .from(inventoryLocations)
      .where(
        and(
          eq(inventoryLocations.organizationId, orgId),
          eq(inventoryLocations.isDefault, true)
        )
      );
    if (!location?.id) throw new Error("Default inventory location not found.");

    const [otherLocation] = await db
      .insert(inventoryLocations)
      .values({
        organizationId: orgId,
        name: `Overflow ${ts}`,
        code: `overflow-${ts}`,
        isDefault: false,
      })
      .returning({ id: inventoryLocations.id });

    await db.transaction(async (tx) => {
      await createPositiveStockEventInTx(tx, {
        organizationId: orgId,
        locationId: location.id,
        itemId,
        quantity: 4,
        unitCost: "2.00",
        eventType: "manual_adjustment_increase",
        eventSubtype: "fast_disable_lots",
        referenceType: "item",
        referenceId: itemId,
      });
      await createPositiveStockEventInTx(tx, {
        organizationId: orgId,
        locationId: location.id,
        itemId,
        quantity: 6,
        unitCost: "2.00",
        eventType: "manual_adjustment_increase",
        eventSubtype: "fast_disable_lots",
        referenceType: "item",
        referenceId: itemId,
      });
      await createPositiveStockEventInTx(tx, {
        organizationId: orgId,
        locationId: otherLocation.id,
        itemId,
        quantity: 9,
        unitCost: "2.00",
        eventType: "manual_adjustment_increase",
        eventSubtype: "fast_disable_lots_other_location",
        referenceType: "item",
        referenceId: itemId,
      });
    });

    const beforeLots = await db
      .select({ lotNumber: lots.lotNumber })
      .from(lots)
      .where(eq(lots.itemId, itemId));
    expect(beforeLots).toHaveLength(3);

    const modeResponse = await testFetch(`/api/item-cards/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: itemName,
        category,
        description: null,
        unitDefinitionId: unitId,
        lotTrackingMode: "untracked",
      }),
    });
    expect(
      modeResponse.status,
      JSON.stringify(await modeResponse.json().catch(() => null))
    ).toBe(200);

    let lotRows = await db
      .select({
        id: lots.id,
        lotNumber: lots.lotNumber,
        quantity: lots.quantity,
      })
      .from(lots)
      .where(eq(lots.itemId, itemId));
    expect(lotRows).toEqual([
      expect.objectContaining({
        lotNumber: INTERNAL_UNTRACKED_LOT_NUMBER,
        quantity: "19.0000",
      }),
    ]);

    const eventRows = await db
      .select({ lotId: inventoryEvents.lotId })
      .from(inventoryEvents)
      .where(eq(inventoryEvents.itemId, itemId));
    expect(new Set(eventRows.map((event) => event.lotId))).toEqual(
      new Set([lotRows[0].id])
    );

    const untrackedBalances = await db
      .select({
        locationId: inventoryLotBalances.locationId,
        quantity: inventoryLotBalances.quantity,
      })
      .from(inventoryLotBalances)
      .where(
        and(
          eq(inventoryLotBalances.itemId, itemId),
          eq(inventoryLotBalances.lotId, lotRows[0].id),
          eq(inventoryLotBalances.disposition, "available")
        )
      )
      .orderBy(inventoryLotBalances.locationId);
    expect(untrackedBalances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ locationId: location.id, quantity: "10.0000" }),
        expect.objectContaining({ locationId: otherLocation.id, quantity: "9.0000" }),
      ])
    );

    const trackedModeResponse = await testFetch(`/api/item-cards/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: itemName,
        category,
        description: null,
        unitDefinitionId: unitId,
        lotTrackingMode: "tracked",
      }),
    });
    expect(
      trackedModeResponse.status,
      JSON.stringify(await trackedModeResponse.json().catch(() => null))
    ).toBe(200);

    lotRows = await db
      .select({
        id: lots.id,
        lotNumber: lots.lotNumber,
        quantity: lots.quantity,
      })
      .from(lots)
      .where(eq(lots.itemId, itemId));
    expect(lotRows).toHaveLength(1);
    expect(lotRows[0]?.lotNumber).toMatch(/^LOT-\d{4}-\d{2}-\d{2}/);
    expect(lotRows[0]?.quantity).toBe("19.0000");
  });

  test("stocktake count becomes authoritative stock truth", async ({ db }) => {
    const category = `Fast Stocktake ${ts}`;
    const item = await createItem({
      itemType: "material",
      name: `Fast Stocktake Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-STOCKTAKE-${ts}`,
      category,
      description: null,
      defaultPurchasePrice: "3.00",
      defaultSellingPrice: null,
      stock: "10",
      safetyStock: "0",
      bom: [],
    });
    expect(item.status).toBe(201);
    const itemId = item.body.id as string;

    const stocktakeResponse = await testFetch("/api/stocktakes", {
      method: "POST",
      body: JSON.stringify({
        name: `Fast Stocktake ${ts}`,
        scope: buildStocktakeCategoryScope("material", category),
        notes: null,
      }),
    });
    expect(stocktakeResponse.status).toBe(201);
    const stocktake = await stocktakeResponse.json();

    const [line] = await db
      .select({ id: stocktakeItems.id })
      .from(stocktakeItems)
      .where(
        and(
          eq(stocktakeItems.stocktakeId, stocktake.id),
          eq(stocktakeItems.itemId, itemId)
        )
      );
    expect(line?.id).toBeTruthy();

    const [lotLine] = await db
      .select({ id: stocktakeLotItems.id, lotId: stocktakeLotItems.lotId })
      .from(stocktakeLotItems)
      .where(eq(stocktakeLotItems.stocktakeItemId, line.id));
    expect(lotLine?.id).toBeTruthy();
    const lotId = lotLine?.lotId;
    expect(lotId).toBeTruthy();

    const [allocation] = await db
      .insert(stockAllocations)
      .values({
        organizationId: orgId,
        demandType: "manufacturing_order_ingredient",
        demandId: randomUUID(),
        itemId,
        sourceType: "inventory_lot",
        sourceId: lotId!,
        quantity: "6.0000",
        status: "active",
      })
      .returning({ id: stockAllocations.id });

    const saveResponse = await testFetch(`/api/stocktakes/${stocktake.id}`, {
      method: "PUT",
      body: JSON.stringify({
        lines: [],
        lotLines: [{ lotLineId: lotLine.id, countedQty: "3" }],
      }),
    });
    expect(saveResponse.status).toBe(200);

    const completeResponse = await testFetch(
      `/api/stocktakes/${stocktake.id}/complete`,
      {
        method: "POST",
        body: JSON.stringify({ confirmStale: false, reason: "Cycle count" }),
      }
    );
    expect(completeResponse.status).toBe(200);

    const [completed] = await db
      .select({ status: stocktakes.status })
      .from(stocktakes)
      .where(eq(stocktakes.id, stocktake.id));
    expect(completed.status).toBe("completed");

    const [lotTotal] = await db
      .select({ quantity: sql<string>`COALESCE(SUM(${lots.quantity}), 0)` })
      .from(lots)
      .where(eq(lots.itemId, itemId));
    expect(Number(lotTotal.quantity)).toBe(3);

    const [reducedAllocation] = await db
      .select({ quantity: stockAllocations.quantity, status: stockAllocations.status })
      .from(stockAllocations)
      .where(eq(stockAllocations.id, allocation.id));
    expect(reducedAllocation).toMatchObject({
      quantity: "3.0000",
      status: "active",
    });

    const events = await db
      .select({ eventType: inventoryEvents.eventType })
      .from(inventoryEvents)
      .where(sql`${inventoryEvents.metadata}->>'stocktakeId' = ${stocktake.id}`);
    expect(events.some((event) => event.eventType === "stocktake_loss")).toBe(true);
  });

  test("available disposition reductions release excess lot holds", async ({ db }) => {
    const item = await createItem({
      itemType: "material",
      name: `Fast Disposition Allocation ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-DISP-ALLOC-${ts}`,
      category: `Fast Disposition ${ts}`,
      description: null,
      defaultPurchasePrice: "4.00",
      defaultSellingPrice: null,
      stock: "10",
      safetyStock: "0",
      bom: [],
    });
    expect(item.status).toBe(201);
    const itemId = item.body.id as string;

    const [lot] = await db
      .select({ id: lots.id })
      .from(lots)
      .where(eq(lots.itemId, itemId));
    expect(lot?.id).toBeTruthy();

    const [allocation] = await db
      .insert(stockAllocations)
      .values({
        organizationId: orgId,
        demandType: "manufacturing_order_ingredient",
        demandId: randomUUID(),
        itemId,
        sourceType: "inventory_lot",
        sourceId: lot.id,
        quantity: "8.0000",
        status: "active",
      })
      .returning({ id: stockAllocations.id });

    const response = await testFetch(`/api/items/${itemId}/lots/${lot.id}/disposition`, {
      method: "POST",
      body: JSON.stringify({
        action: "block",
        fromDisposition: "available",
        quantity: "7",
        notes: null,
      }),
    });
    expect(response.status).toBe(200);

    const [availableBalance] = await db
      .select({ quantity: inventoryLotBalances.quantity })
      .from(inventoryLotBalances)
      .where(
        and(
          eq(inventoryLotBalances.itemId, itemId),
          eq(inventoryLotBalances.lotId, lot.id),
          eq(inventoryLotBalances.disposition, "available")
        )
      );
    expect(availableBalance.quantity).toBe("3.0000");

    const [reducedAllocation] = await db
      .select({ quantity: stockAllocations.quantity, status: stockAllocations.status })
      .from(stockAllocations)
      .where(eq(stockAllocations.id, allocation.id));
    expect(reducedAllocation).toMatchObject({
      quantity: "3.0000",
      status: "active",
    });
  });

  test("stocktake completion cancels stale lot holds and releases manufacturing reservations", async ({
    db,
  }) => {
    const category = `Fast Stocktake Hold ${ts}`;
    const item = await createItem({
      itemType: "material",
      name: `Fast Stocktake Held Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-STOCKTAKE-HOLD-${ts}`,
      category,
      description: null,
      defaultPurchasePrice: "4.00",
      defaultSellingPrice: null,
      stock: "10",
      safetyStock: "0",
      bom: [],
    });
    expect(item.status).toBe(201);
    const itemId = item.body.id as string;

    const [defaultLocation] = await db
      .select({ id: inventoryLocations.id })
      .from(inventoryLocations)
      .where(
        and(
          eq(inventoryLocations.organizationId, orgId),
          eq(inventoryLocations.isDefault, true)
        )
      );
    const [lot] = await db
      .select({ id: lots.id })
      .from(lots)
      .where(eq(lots.itemId, itemId));
    expect(defaultLocation?.id).toBeTruthy();
    expect(lot?.id).toBeTruthy();

    const [order] = await db
      .insert(manufacturingOrders)
      .values({
        organizationId: orgId,
        orderNumber: `FAST-MO-HOLD-${ts}`,
        productId: itemId,
        productName: `Fast MO Held Product ${ts}`,
        productSku: `FAST-MO-HOLD-${ts}`,
        unitName: "Each",
        requestedQuantity: "1",
        plannedQuantity: "1",
        status: "open",
      })
      .returning({ id: manufacturingOrders.id });
    const [ingredient] = await db
      .insert(manufacturingOrderIngredients)
      .values({
        manufacturingOrderId: order.id,
        itemId,
        itemName: `Fast Stocktake Held Material ${ts}`,
        itemType: "material",
        unitName: "Each",
        quantityPerUnit: "10",
        plannedQuantity: "10",
      })
      .returning({ id: manufacturingOrderIngredients.id });

    const [hold] = await db
      .insert(stockAllocations)
      .values({
        organizationId: orgId,
        demandType: "manufacturing_order_ingredient",
        demandId: ingredient.id,
        itemId,
        sourceType: "inventory_lot",
        sourceId: lot.id,
        quantity: "10",
        status: "active",
      })
      .returning({ id: stockAllocations.id });
    await db.insert(inventoryReservationsSummary).values({
      organizationId: orgId,
      locationId: defaultLocation.id,
      itemId,
      referenceType: "manufacturing_order_ingredient",
      referenceId: ingredient.id,
      quantity: "10",
    });
    await db.insert(inventoryEvents).values({
      organizationId: orgId,
      locationId: defaultLocation.id,
      eventType: "reservation_increase",
      eventSubtype: "test_hold",
      itemId,
      quantity: "10",
      referenceType: "manufacturing_order_ingredient",
      referenceId: ingredient.id,
      actorUserId: "test",
    });
    await db
      .update(inventoryItemBalances)
      .set({
        committedQty: sql`${inventoryItemBalances.committedQty} + 10`,
      })
      .where(eq(inventoryItemBalances.itemId, itemId));

    const stocktakeResponse = await testFetch("/api/stocktakes", {
      method: "POST",
      body: JSON.stringify({
        name: `Fast Stocktake Hold ${ts}`,
        scope: buildStocktakeCategoryScope("material", category),
        notes: null,
      }),
    });
    expect(stocktakeResponse.status).toBe(201);
    const stocktake = await stocktakeResponse.json();

    const [line] = await db
      .select({ id: stocktakeItems.id })
      .from(stocktakeItems)
      .where(
        and(
          eq(stocktakeItems.stocktakeId, stocktake.id),
          eq(stocktakeItems.itemId, itemId)
        )
      );
    const [lotLine] = await db
      .select({ id: stocktakeLotItems.id })
      .from(stocktakeLotItems)
      .where(eq(stocktakeLotItems.stocktakeItemId, line.id));

    const saveResponse = await testFetch(`/api/stocktakes/${stocktake.id}`, {
      method: "PUT",
      body: JSON.stringify({
        lines: [],
        lotLines: [{ lotLineId: lotLine.id, countedQty: "0" }],
      }),
    });
    expect(saveResponse.status).toBe(200);

    const completeResponse = await testFetch(
      `/api/stocktakes/${stocktake.id}/complete`,
      {
        method: "POST",
        body: JSON.stringify({ confirmStale: false, reason: "Cycle count" }),
      }
    );
    expect(completeResponse.status).toBe(200);

    const [allocation] = await db
      .select({
        status: stockAllocations.status,
        cancelledAt: stockAllocations.cancelledAt,
      })
      .from(stockAllocations)
      .where(eq(stockAllocations.id, hold.id));
    expect(allocation.status).toBe("cancelled");
    expect(allocation.cancelledAt).toBeTruthy();

    const [reservation] = await db
      .select({
        quantity: sql<string>`COALESCE(SUM(${inventoryReservationsSummary.quantity}), 0)`,
      })
      .from(inventoryReservationsSummary)
      .where(eq(inventoryReservationsSummary.referenceId, ingredient.id));
    const [balance] = await db
      .select({ committedQty: inventoryItemBalances.committedQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, itemId));

    expect(Number(reservation.quantity)).toBe(0);
    expect(Number(balance.committedQty)).toBe(0);
  });

  test("item card clone copies variant structure and current recipe without stock", async ({
    db,
  }) => {
    const [resource] = await db
      .insert(manufacturingResources)
      .values({
        organizationId: orgId,
        name: `Fast Clone Labor ${ts}`,
        resourceType: "labor",
        loadedCostPerHour: "60.000000",
      })
      .returning({ id: manufacturingResources.id });

    const component = await createItem({
      itemType: "material",
      name: `Fast Clone Component ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-CLONE-COMP-${ts}`,
      category: `Fast Clone ${ts}`,
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
      name: `Fast Clone Product ${ts}`,
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-CLONE-PROD-${ts}`,
      category: `Fast Clone ${ts}`,
      description: "Clone source",
      defaultPurchasePrice: null,
      defaultSellingPrice: "12.00",
      registeredBarcode: `REG-${ts}`,
      internalBarcode: `INT-${ts}`,
      stock: "7",
      safetyStock: "3",
      bom: [{ componentId: component.body.id, quantity: "2" }],
      operationCosts: [
        {
          operationName: "Assembly",
          resourceId: resource.id,
          costScalingMode: "per_output_unit",
          crewSize: "1",
          plannedMinutes: "10",
          loadedCostPerHour: "60",
        },
      ],
    });
    expect(product.status).toBe(201);
    const sourceItemId = product.body.id as string;

    const configResponse = await testFetch(
      `/api/item-cards/${sourceItemId}/variant-config`,
      {
        method: "PUT",
        body: JSON.stringify({
          options: [
            {
              name: "Size",
              code: "size",
              values: [
                { label: "Small", code: "small" },
                { label: "Large", code: "large" },
              ],
            },
          ],
        }),
      },
    );
    expect(configResponse.status).toBe(200);

    const generateResponse = await testFetch(
      `/api/item-cards/${sourceItemId}/variants/generate`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );
    expect(generateResponse.status).toBe(201);

    const cloneIdempotencyKey = `fast-clone-card:${ts}:${sourceItemId}`;
    const cloneResponse = await testFetch(`/api/item-cards/${sourceItemId}/clone`, {
      method: "POST",
      headers: { "Idempotency-Key": cloneIdempotencyKey },
    });
    expect(cloneResponse.status).toBe(201);
    const cloneBody = await cloneResponse.json();
    const clonedItemId = cloneBody.itemId as string;
    expect(clonedItemId).not.toBe(sourceItemId);

    const cloneReplayResponse = await testFetch(`/api/item-cards/${sourceItemId}/clone`, {
      method: "POST",
      headers: { "Idempotency-Key": cloneIdempotencyKey },
    });
    expect(cloneReplayResponse.status).toBe(201);
    const cloneReplayBody = await cloneReplayResponse.json();
    expect(cloneReplayBody.itemId).toBe(clonedItemId);

    const clonedCardResponse = await testFetch(`/api/item-cards/${clonedItemId}`);
    expect(clonedCardResponse.status).toBe(200);
    const clonedCard = await clonedCardResponse.json();

    expect(clonedCard.family.name).toBe(`Copy of Fast Clone Product ${ts}`);
    expect(clonedCard.family.category).toBe(`Fast Clone ${ts}`);
    expect(clonedCard.options).toHaveLength(1);
    expect(clonedCard.options[0].values).toHaveLength(2);
    expect(clonedCard.variants).toHaveLength(2);
    expect(
      clonedCard.variants.every(
        (variant: {
          sku: string | null;
          registeredBarcode: string | null;
          internalBarcode: string | null;
          optionValues: unknown[];
        }) =>
          variant.sku === null &&
          variant.registeredBarcode === null &&
          variant.internalBarcode === null &&
          variant.optionValues.length === 1,
      ),
    ).toBe(true);

    const clonedVariantIds = clonedCard.variants.map(
      (variant: { id: string }) => variant.id,
    );
    const [clonedStock] = await db
      .select({
        onHandQty: sql<string>`COALESCE(SUM(${inventoryItemBalances.onHandQty}), 0)`,
      })
      .from(inventoryItemBalances)
      .where(inArray(inventoryItemBalances.itemId, clonedVariantIds));
    expect(Number(clonedStock.onHandQty)).toBe(0);

    const clonedBomRows = await db
      .select({ id: bomRevisions.id })
      .from(bomRevisions)
      .where(and(eq(bomRevisions.productId, clonedItemId), eq(bomRevisions.isCurrent, true)));
    expect(clonedBomRows).toHaveLength(1);

    const clonedComponentRows = await db
      .select({ id: bomRevisionComponents.id })
      .from(bomRevisionComponents)
      .where(eq(bomRevisionComponents.bomRevisionId, clonedBomRows[0].id));
    expect(clonedComponentRows).toHaveLength(1);

    const clonedOperationRows = await db
      .select({ id: bomRevisionOperationCosts.id })
      .from(bomRevisionOperationCosts)
      .where(eq(bomRevisionOperationCosts.bomRevisionId, clonedBomRows[0].id));
    expect(clonedOperationRows).toHaveLength(1);

    const [clonedFamily] = await db
      .select({ id: itemFamilies.id })
      .from(items)
      .innerJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
      .where(eq(items.id, clonedItemId));
    const clonedOptions = await db
      .select({ id: variantOptions.id })
      .from(variantOptions)
      .where(eq(variantOptions.familyId, clonedFamily.id));
    const clonedValues = await db
      .select({ id: variantOptionValues.id })
      .from(variantOptionValues)
      .innerJoin(variantOptions, eq(variantOptionValues.optionId, variantOptions.id))
      .where(eq(variantOptions.familyId, clonedFamily.id));
    const clonedAssignments = await db
      .select({ itemId: itemVariantValues.itemId })
      .from(itemVariantValues)
      .where(inArray(itemVariantValues.itemId, clonedVariantIds));
    expect(clonedOptions).toHaveLength(1);
    expect(clonedValues).toHaveLength(2);
    expect(clonedAssignments).toHaveLength(2);
  });
});
