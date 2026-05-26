import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  inventoryEvents,
  inventoryItemBalances,
  inventoryLocations,
  inventoryLotBalances,
  lots,
  stockAllocations,
  stocktakeItems,
  stocktakeLotItems,
  stocktakes,
} from "../../../lib/db/schema";
import {
  consumeStockFifoInTx,
  createPositiveStockEventInTx,
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
        body: JSON.stringify({ confirmStale: false }),
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
});
