import { and, asc, eq, sql } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  inventoryEventAdjustmentReasons,
  inventoryEvents,
  lots,
  stocktakeItems,
  stocktakeLotItems,
  stocktakes,
} from "../../../lib/db/schema";
import { getOrgId, testFetch } from "../../helpers/api";
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
        reason: "Cycle count",
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
    await expect(page.getByRole("button", { name: "Found lot" })).toBeVisible();
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

  test("rejects completion when the reason is blank", async () => {
    const complete = await testFetch(`/api/stocktakes/${stocktakeId}/complete`, {
      method: "POST",
      body: JSON.stringify({ confirmStale: false, reason: "  " }),
    });
    expect(complete.status).toBe(400);
  });

  test("rejects stocktake reconciliation requests with inline lines", async () => {
    const response = await testFetch("/api/inventory/reconciliations/preview", {
      method: "POST",
      body: JSON.stringify({
        source: { kind: "stocktake", stocktakeId },
        lines: [
          {
            itemId: materialId,
            reason: "cycle_count",
            newQuantity: "4",
          },
        ],
      }),
    });

    expect(response.status).toBe(400);
  });

  test("commits the saved count as authoritative stock truth", async ({ db }) => {
    const complete = await testFetch(`/api/stocktakes/${stocktakeId}/complete`, {
      method: "POST",
      body: JSON.stringify({ confirmStale: false, reason: "Cycle count" }),
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
      .select({
        id: inventoryEvents.id,
        eventType: inventoryEvents.eventType,
        quantity: inventoryEvents.quantity,
      })
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
    const gain = events.find((event) => event.eventType === "stocktake_gain");
    expect(gain).toBeTruthy();
    const [reason] = await db
      .select({ reason: inventoryEventAdjustmentReasons.reason })
      .from(inventoryEventAdjustmentReasons)
      .where(eq(inventoryEventAdjustmentReasons.inventoryEventId, gain!.id));
    expect(reason.reason).toBe("cycle_count");

    // The completion reason was persisted onto the stocktake row.
    const [reconciled] = await db
      .select({ reason: stocktakes.reason })
      .from(stocktakes)
      .where(eq(stocktakes.id, stocktakeId));
    expect(reconciled.reason).toBe("Cycle count");

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
        reason: "Cycle count",
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

    const deleteFound = await testFetch(`/api/stocktakes/${foundStocktakeId}`, {
      method: "PUT",
      body: JSON.stringify({
        lines: [],
        lotLines: [{ lotLineId: savedFound.id, delete: true }],
      }),
    });
    expect(deleteFound.status, await deleteFound.text()).toBe(200);

    const deletedFoundRows = await db
      .select({ id: stocktakeLotItems.id })
      .from(stocktakeLotItems)
      .where(eq(stocktakeLotItems.id, savedFound.id));
    expect(deletedFoundRows).toHaveLength(0);

    const resave = await testFetch(`/api/stocktakes/${foundStocktakeId}`, {
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
    expect(resave.status, await resave.text()).toBe(200);

    const complete = await testFetch(
      "/api/inventory/reconciliations",
      {
        method: "POST",
        body: JSON.stringify({
          source: {
            kind: "stocktake",
            stocktakeId: foundStocktakeId,
            confirmStale: false,
            reason: "Cycle count",
          },
          lines: [],
        }),
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

  test("rejects a found lot number that exists as active inventory for the item", async ({
    db,
  }) => {
    const material = await createMaterialFixture({
      name: "Found Lot Reject Material",
      stock: "2",
      cost: "3.00",
    });
    const [existingLot] = await db
      .select({ lotNumber: lots.lotNumber })
      .from(lots)
      .where(eq(lots.itemId, material.id));
    expect(existingLot?.lotNumber).toBeTruthy();

    const create = await testFetch("/api/stocktakes", {
      method: "POST",
      body: JSON.stringify({
        name: `Found Lot Reject ${Date.now()}`,
        scope: "all",
        reason: "Cycle count",
        notes: null,
        itemIds: [material.id],
      }),
    });
    expect(create.status).toBe(201);
    const stocktakeId = (await create.json()).id as string;

    const [line] = await db
      .select()
      .from(stocktakeItems)
      .where(
        and(
          eq(stocktakeItems.stocktakeId, stocktakeId),
          eq(stocktakeItems.itemId, material.id)
        )
      );

    const save = await testFetch(`/api/stocktakes/${stocktakeId}`, {
      method: "PUT",
      body: JSON.stringify({
        lines: [],
        lotLines: [
          {
            isFound: true,
            stocktakeItemId: line.id,
            lotNumber: existingLot.lotNumber,
            countedQty: "2",
          },
        ],
      }),
    });
    expect(save.status).toBe(400);

    // No found row was persisted for the colliding lot number.
    const foundRows = await db
      .select({ id: stocktakeLotItems.id })
      .from(stocktakeLotItems)
      .where(
        and(
          eq(stocktakeLotItems.stocktakeItemId, line.id),
          eq(stocktakeLotItems.isFound, true)
        )
    );
    expect(foundRows).toHaveLength(0);
  });

  test("does not snapshot zero-balance lots as active countable lots", async ({
    db,
  }) => {
    const material = await createMaterialFixture({
      name: "Zero Lot Snapshot Material",
      stock: "0",
      cost: "3.00",
    });
    const existingLotNumber = `ZERO-${Date.now()}`;
    await db
      .insert(lots)
      .values({
        organizationId: getOrgId(),
        itemId: material.id,
        lotNumber: existingLotNumber,
        quantity: "0",
        receivedAt: new Date(),
      });

    const create = await testFetch("/api/stocktakes", {
      method: "POST",
      body: JSON.stringify({
        name: `Zero Lot Snapshot ${Date.now()}`,
        scope: "all",
        reason: "Cycle count",
        notes: null,
        itemIds: [material.id],
      }),
    });
    expect(create.status).toBe(201);
    const stocktakeId = (await create.json()).id as string;

    const [line] = await db
      .select()
      .from(stocktakeItems)
      .where(
        and(
          eq(stocktakeItems.stocktakeId, stocktakeId),
          eq(stocktakeItems.itemId, material.id)
        )
      );
    const snapshotLots = await db
      .select({
        lotId: stocktakeLotItems.lotId,
        lotNumber: stocktakeLotItems.lotNumber,
        expectedQty: stocktakeLotItems.expectedQty,
      })
      .from(stocktakeLotItems)
      .where(eq(stocktakeLotItems.stocktakeItemId, line.id));

    expect(snapshotLots).toEqual([]);

    const save = await testFetch(`/api/stocktakes/${stocktakeId}`, {
      method: "PUT",
      body: JSON.stringify({
        lines: [],
        lotLines: [
          {
            isFound: true,
            stocktakeItemId: line.id,
            lotNumber: existingLotNumber,
            countedQty: "2",
          },
        ],
      }),
    });
    expect(save.status).toBe(200);

    const foundRows = await db
      .select({ id: stocktakeLotItems.id })
      .from(stocktakeLotItems)
      .where(
        and(
          eq(stocktakeLotItems.stocktakeItemId, line.id),
          eq(stocktakeLotItems.isFound, true)
        )
      );
    expect(foundRows).toHaveLength(1);
  });

  test("completing one lot preserves untouched lots in the parent completed total", async ({
    db,
  }) => {
    const material = await createMaterialFixture({
      name: "Partial Lot Rollup Material",
      stock: "0",
      cost: "3.00",
    });
    const receivedAt = new Date();
    const [lotA] = await db
      .insert(lots)
      .values({
        organizationId: getOrgId(),
        itemId: material.id,
        lotNumber: `ROLL-A-${Date.now()}`,
        quantity: "0",
        receivedAt,
      })
      .returning({ id: lots.id });
    const [lotB] = await db
      .insert(lots)
      .values({
        organizationId: getOrgId(),
        itemId: material.id,
        lotNumber: `ROLL-B-${Date.now()}`,
        quantity: "0",
        receivedAt,
      })
      .returning({ id: lots.id });

    for (const [lotId, quantity] of [
      [lotA.id, "5"],
      [lotB.id, "45"],
    ] as const) {
      const adjust = await testFetch(`/api/items/${material.id}/stock-adjustments`, {
        method: "POST",
        body: JSON.stringify({
          reason: "data_correction",
          lots: [{ lotId, newQuantity: quantity }],
        }),
      });
      expect(adjust.status, await adjust.text()).toBe(200);
    }

    const create = await testFetch("/api/stocktakes", {
      method: "POST",
      body: JSON.stringify({
        name: `Partial Lot Rollup ${Date.now()}`,
        scope: "all",
        reason: "Cycle count",
        notes: null,
        itemIds: [material.id],
      }),
    });
    expect(create.status).toBe(201);
    const stocktakeId = (await create.json()).id as string;

    const [line] = await db
      .select()
      .from(stocktakeItems)
      .where(
        and(
          eq(stocktakeItems.stocktakeId, stocktakeId),
          eq(stocktakeItems.itemId, material.id)
        )
      );
    const lotLines = await db
      .select({
        id: stocktakeLotItems.id,
        lotId: stocktakeLotItems.lotId,
      })
      .from(stocktakeLotItems)
      .where(eq(stocktakeLotItems.stocktakeItemId, line.id));
    const lotALine = lotLines.find((row) => row.lotId === lotA.id);
    expect(lotALine).toBeTruthy();

    const save = await testFetch(`/api/stocktakes/${stocktakeId}`, {
      method: "PUT",
      body: JSON.stringify({
        lines: [],
        lotLines: [{ lotLineId: lotALine!.id, countedQty: "7" }],
      }),
    });
    expect(save.status, await save.text()).toBe(200);

    const complete = await testFetch(`/api/stocktakes/${stocktakeId}/complete`, {
      method: "POST",
      body: JSON.stringify({ confirmStale: false, reason: "Cycle count" }),
    });
    expect(complete.status, await complete.text()).toBe(200);

    const [completedLine] = await db
      .select({
        expectedQty: stocktakeItems.expectedQty,
        countedQty: stocktakeItems.countedQty,
        varianceQty: stocktakeItems.varianceQty,
      })
      .from(stocktakeItems)
      .where(eq(stocktakeItems.id, line.id));

    expect(completedLine.expectedQty).toBe("50.0000");
    expect(completedLine.countedQty).toBe("52.0000");
    expect(completedLine.varianceQty).toBe("2.0000");
  });

  test("re-submitting the same found lot does not create duplicate rows", async ({
    db,
  }) => {
    const material = await createMaterialFixture({
      name: "Found Lot Idempotent Material",
      stock: "0",
      cost: "3.00",
    });

    const create = await testFetch("/api/stocktakes", {
      method: "POST",
      body: JSON.stringify({
        name: `Found Lot Idempotent ${Date.now()}`,
        scope: "all",
        reason: "Cycle count",
        notes: null,
        itemIds: [material.id],
      }),
    });
    expect(create.status).toBe(201);
    const stocktakeId = (await create.json()).id as string;

    const [line] = await db
      .select()
      .from(stocktakeItems)
      .where(
        and(
          eq(stocktakeItems.stocktakeId, stocktakeId),
          eq(stocktakeItems.itemId, material.id)
        )
      );

    const lotNumber = `IDEMPOTENT-${Date.now()}`;
    const body = JSON.stringify({
      lines: [],
      lotLines: [
        {
          isFound: true,
          stocktakeItemId: line.id,
          lotNumber,
          countedQty: "3",
        },
      ],
    });

    const first = await testFetch(`/api/stocktakes/${stocktakeId}`, {
      method: "PUT",
      body,
    });
    expect(first.status, await first.text()).toBe(200);

    const second = await testFetch(`/api/stocktakes/${stocktakeId}`, {
      method: "PUT",
      body: JSON.stringify({
        lines: [],
        lotLines: [
          {
            isFound: true,
            stocktakeItemId: line.id,
            lotNumber,
            countedQty: "9",
          },
        ],
      }),
    });
    expect(second.status, await second.text()).toBe(200);

    const foundRows = await db
      .select({
        id: stocktakeLotItems.id,
        countedQty: stocktakeLotItems.countedQty,
      })
      .from(stocktakeLotItems)
      .where(
        and(
          eq(stocktakeLotItems.stocktakeItemId, line.id),
          eq(stocktakeLotItems.isFound, true),
          eq(stocktakeLotItems.lotNumber, lotNumber)
        )
      );
    expect(foundRows).toHaveLength(1);
    // The retry updated the counted quantity in place.
    expect(foundRows[0].countedQty).toBe("9.0000");
  });
});
