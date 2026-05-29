import { and, asc, eq, sql } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  inventoryEvents,
  lots,
  stocktakeItems,
  stocktakeLotItems,
  stocktakes,
} from "../../../lib/db/schema";
import { testFetch } from "../../helpers/api";
import { createMaterialFixture } from "./story-helpers";

test.describe("stocktake workflow operating story", () => {
  test.describe.configure({ mode: "serial" });

  let materialId: string;
  let materialName: string;
  let stocktakeId: string;
  let lineId: string;

  test("opens an all-items stocktake with current stock snapshot", async ({ db, page }) => {
    const material = await createMaterialFixture({
      name: "Stocktake Story Material",
      stock: "0",
      cost: "2.50",
    });
    materialId = material.id;
    materialName = material.name;

    const response = await testFetch("/api/stocktakes", {
      method: "POST",
      body: JSON.stringify({
        name: `Stocktake Story ${Date.now()}`,
        scope: "all",
        notes: null,
        itemIds: [materialId],
      }),
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    stocktakeId = body.id as string;

    const [line] = await db
      .select()
      .from(stocktakeItems)
      .where(
        and(
          eq(stocktakeItems.stocktakeId, stocktakeId),
          eq(stocktakeItems.itemId, materialId)
        )
      )
      .orderBy(asc(stocktakeItems.sortOrder));
    lineId = line.id;
    expect(line.expectedQty).toBe("0.0000");

    await page.goto(`/inventory/stocktakes/${stocktakeId}`);
    await expect(page.locator("main")).toContainText(materialName);
  });

  test("saves sparse draft counts and reloads the persisted count", async ({ db, page }) => {
    const saveResponse = await testFetch(`/api/stocktakes/${stocktakeId}`, {
      method: "PUT",
      body: JSON.stringify({
        lines: [{ lineId, countedQty: "4" }],
        lotLines: [],
      }),
    });
    expect(saveResponse.status).toBe(200);

    const [savedLine] = await db
      .select()
      .from(stocktakeItems)
      .where(eq(stocktakeItems.id, lineId));
    expect(savedLine.countedQty).toBe("4.0000");
    expect(savedLine.varianceQty).toBe("4.0000");

    await page.goto(`/inventory/stocktakes/${stocktakeId}`);
    await expect(page.locator("main")).toContainText("Draft");
    await page.reload();
    await expect(page.locator("main")).toContainText("Draft");
  });

  test("commits the saved count as authoritative stock truth", async ({ db }) => {
    const complete = await testFetch(`/api/stocktakes/${stocktakeId}/complete`, {
      method: "POST",
      body: JSON.stringify({ confirmStale: false }),
    });
    expect(complete.status).toBe(200);

    await expect
      .poll(async () => {
        const [stocktake] = await db
          .select({ status: stocktakes.status })
          .from(stocktakes)
          .where(eq(stocktakes.id, stocktakeId));
        return stocktake?.status ?? null;
      }, { timeout: 30_000 })
      .toBe("completed");
  });

  test("commit preserves completed reconciliation state and applies the variance", async ({
    db,
    page,
  }) => {
    const [line] = await db
      .select()
      .from(stocktakeItems)
      .where(eq(stocktakeItems.id, lineId));
    expect(line.countedQty).toBe("4.0000");
    expect(line.appliedDeltaQty).toBe("4.0000");

    const [stock] = await db
      .select({ total: sql<string>`COALESCE(SUM(${lots.quantity}), 0)` })
      .from(lots)
      .where(eq(lots.itemId, materialId));
    expect(stock.total).toBe("4.0000");

    const events = await db
      .select({ eventType: inventoryEvents.eventType, quantity: inventoryEvents.quantity })
      .from(inventoryEvents)
      .where(sql`${inventoryEvents.metadata}->>'stocktakeId' = ${stocktakeId}`);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "stocktake_gain",
          quantity: "4.0000",
        }),
      ])
    );

    await page.goto(`/inventory/stocktakes/${stocktakeId}`);
    await expect(page.locator("main").getByText("Completed", { exact: true }).first()).toBeVisible();
  });
});

test.describe("stocktake found-lot operating story", () => {
  test.describe.configure({ mode: "serial" });

  let foundMaterialId: string;
  let foundStocktakeId: string;
  let foundLineId: string;
  const foundLotNumber = `FOUND-${Date.now()}`;

  test("records an unexpected lot discovered on the floor and posts a gain", async ({
    db,
  }) => {
    const material = await createMaterialFixture({
      name: "Found Lot Material",
      stock: "0",
      cost: "3.00",
    });
    foundMaterialId = material.id;

    const create = await testFetch("/api/stocktakes", {
      method: "POST",
      body: JSON.stringify({
        name: `Found Lot Story ${Date.now()}`,
        scope: "all",
        notes: null,
        itemIds: [foundMaterialId],
      }),
    });
    expect(create.status).toBe(201);
    foundStocktakeId = (await create.json()).id as string;

    const [line] = await db
      .select()
      .from(stocktakeItems)
      .where(
        and(
          eq(stocktakeItems.stocktakeId, foundStocktakeId),
          eq(stocktakeItems.itemId, foundMaterialId)
        )
      );
    foundLineId = line.id;

    // Operator records a lot that was never in the snapshot.
    const save = await testFetch(`/api/stocktakes/${foundStocktakeId}`, {
      method: "PUT",
      body: JSON.stringify({
        lines: [],
        lotLines: [
          {
            isFound: true,
            stocktakeItemId: foundLineId,
            lotNumber: foundLotNumber,
            countedQty: "7",
          },
        ],
      }),
    });
    expect(save.status, await save.text()).toBe(200);

    const [savedFound] = await db
      .select()
      .from(stocktakeLotItems)
      .where(
        and(
          eq(stocktakeLotItems.stocktakeItemId, foundLineId),
          eq(stocktakeLotItems.isFound, true)
        )
      );
    expect(savedFound).toBeTruthy();
    expect(savedFound.lotId).toBeNull();
    expect(savedFound.countedQty).toBe("7.0000");
    expect(savedFound.expectedQty).toBe("0.0000");

    const complete = await testFetch(
      `/api/stocktakes/${foundStocktakeId}/complete`,
      {
        method: "POST",
        body: JSON.stringify({ confirmStale: false }),
      }
    );
    expect(complete.status, await complete.text()).toBe(200);

    await expect
      .poll(async () => {
        const [stocktake] = await db
          .select({ status: stocktakes.status })
          .from(stocktakes)
          .where(eq(stocktakes.id, foundStocktakeId));
        return stocktake?.status ?? null;
      }, { timeout: 30_000 })
      .toBe("completed");

    // The found lot now exists for the item at the counted quantity.
    const [createdLot] = await db
      .select({ id: lots.id, quantity: lots.quantity })
      .from(lots)
      .where(
        and(
          eq(lots.itemId, foundMaterialId),
          eq(lots.lotNumber, foundLotNumber)
        )
      );
    expect(createdLot).toBeTruthy();
    expect(createdLot.quantity).toBe("7.0000");

    // A stocktake_gain inventory event was written for the new lot.
    const events = await db
      .select({
        eventType: inventoryEvents.eventType,
        quantity: inventoryEvents.quantity,
        lotId: inventoryEvents.lotId,
      })
      .from(inventoryEvents)
      .where(sql`${inventoryEvents.metadata}->>'stocktakeId' = ${foundStocktakeId}`);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "stocktake_gain",
          quantity: "7.0000",
          lotId: createdLot.id,
        }),
      ])
    );

    // The found-lot stocktake row was backfilled with the created lot id.
    const [reconciledFound] = await db
      .select({ lotId: stocktakeLotItems.lotId })
      .from(stocktakeLotItems)
      .where(
        and(
          eq(stocktakeLotItems.stocktakeItemId, foundLineId),
          eq(stocktakeLotItems.isFound, true)
        )
      );
    expect(reconciledFound.lotId).toBe(createdLot.id);
  });
});
