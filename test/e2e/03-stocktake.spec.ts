import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { test, expect, getIdFromUrl } from "./fixtures";
import {
  createItem,
  deleteItem,
  getUnitId,
  testFetch,
  updateItem,
} from "../helpers/api";
import {
  getTestTimestamp,
  withTs,
  ALL_MATERIALS,
  PRODUCTS,
  PRO_BASE_BOM,
} from "../helpers/paonia";
import {
  items,
  lots,
  stockMovements,
  stocktakeItems,
  stocktakes,
} from "../../lib/db/schema";

test.describe("Chapter 3 — Stocktake: Paonia Soil Co.", () => {
  test.describe.configure({ mode: "serial" });

  // ── Shared timestamp from inventory spec ──────────────────────────
  const ts = getTestTimestamp();

  // ── Per-run timestamp for stocktake names to avoid collisions ──────
  const runTs = Date.now();

  // ── Resolved inventory IDs ─────────────────────────────────────────
  const materialIds: Record<string, string> = {};
  const productIds: Record<string, string> = {};
  let simpleProductId: string;

  // ── Coconut Coir's stock at the start of this chapter ──────────────
  let coconutCoirStartStock: number;

  // ── Stocktake IDs ──────────────────────────────────────────────────
  let allItemsStocktakeId: string;
  let materialsOnlyStocktakeId: string;
  let productsOnlyStocktakeId: string;

  /* ══════════════════════════════════════════════════════════════════
     1. Resolves materials and products from inventory spec
     ══════════════════════════════════════════════════════════════════ */

  test("resolves materials and products from inventory spec", async ({
    db,
  }) => {
    // Resolve all 12 materials
    for (const baseName of ALL_MATERIALS) {
      const name = withTs(baseName, ts);
      const [row] = await db
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.name, name), isNull(items.deletedAt)));
      expect(
        row,
        `${name} not found — run 01-inventory first`
      ).toBeTruthy();
      materialIds[baseName] = row.id;
    }

    // Resolve all 3 products
    for (const baseName of [
      PRODUCTS.NUTE_PACK,
      PRODUCTS.BOMB,
      PRODUCTS.PRO_BASE,
    ]) {
      const name = withTs(baseName, ts);
      const [row] = await db
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.name, name), isNull(items.deletedAt)));
      expect(
        row,
        `${name} not found — run 01-inventory first`
      ).toBeTruthy();
      productIds[baseName] = row.id;
    }

    // Resolve the simple product (Starter Kit)
    {
      const name = withTs("Starter Kit", ts);
      const [row] = await db
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.name, name), isNull(items.deletedAt)));
      expect(
        row,
        `${name} not found — run 01-inventory first`
      ).toBeTruthy();
      simpleProductId = row.id;
    }

    expect(Object.keys(materialIds)).toHaveLength(12);
    expect(Object.keys(productIds)).toHaveLength(3);

    // Read Coconut Coir's current stock from lots table
    const [coconutCoirStock] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${lots.quantity}), 0)`,
      })
      .from(lots)
      .where(eq(lots.itemId, materialIds["Coconut Coir"]));

    coconutCoirStartStock = parseFloat(coconutCoirStock.total);
    expect(coconutCoirStartStock).toBeGreaterThan(0);
  });

  /* ══════════════════════════════════════════════════════════════════
     2. Requires a default purchase price for positive stock additions
     ══════════════════════════════════════════════════════════════════ */

  test("requires a default purchase price for positive stock additions", async ({
    db,
  }) => {
    const unitId = getUnitId();
    const noCostName = `Stocktake No Cost ${runTs}`;

    // Attempt to create a material with positive stock and no cost → 400
    const noCostInitialCreate = await createItem({
      name: `${noCostName} Initial`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `STK-NOCOST-INIT-${runTs}`,
      category: null,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: null,
      stock: "1",
      safetyStock: "0",
      bom: [],
    });

    expect(noCostInitialCreate.status).toBe(400);
    expect(
      noCostInitialCreate.body?.errors?.defaultPurchasePrice?.[0]
    ).toContain("default purchase price");

    // Create zero-stock material without cost → 201
    const noCostCreate = await createItem({
      name: noCostName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `STK-NOCOST-${runTs}`,
      category: null,
      description: "Zero-stock material without a default purchase price",
      defaultPurchasePrice: null,
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });

    expect(noCostCreate.status).toBe(201);
    const noCostMaterialId = noCostCreate.body.id;

    // Update to positive stock without cost → 400
    const noCostUpdate = await updateItem(noCostMaterialId, {
      name: noCostName,
      sku: `STK-NOCOST-${runTs}`,
      category: null,
      description: "Zero-stock material without a default purchase price",
      defaultPurchasePrice: null,
      defaultSellingPrice: null,
      safetyStock: "0",
      stock: "2",
      bom: [],
    });

    expect(noCostUpdate.status).toBe(400);
    expect(noCostUpdate.body?.errors?.defaultPurchasePrice?.[0]).toContain(
      "default purchase price"
    );

    // Create a stocktake scoped to materials
    const stocktakeResponse = await testFetch("/api/stocktakes", {
      method: "POST",
      body: JSON.stringify({
        name: `No Cost Count ${runTs}`,
        scope: "material",
        notes: null,
      }),
    });
    const stocktakeBody = await stocktakeResponse.json();

    expect(stocktakeResponse.status).toBe(201);
    const noCostStocktakeId = stocktakeBody.id;

    // Verify the no-cost material has a stocktake line
    const [noCostLine] = await db
      .select({ id: stocktakeItems.id })
      .from(stocktakeItems)
      .where(
        and(
          eq(stocktakeItems.stocktakeId, noCostStocktakeId),
          eq(stocktakeItems.itemId, noCostMaterialId)
        )
      );

    expect(noCostLine).toBeTruthy();

    // Save a counted qty of 1 for the no-cost material
    const saveResponse = await testFetch(
      `/api/stocktakes/${noCostStocktakeId}`,
      {
        method: "PUT",
        body: JSON.stringify({
          lines: [
            {
              lineId: noCostLine.id,
              countedQty: "1",
            },
          ],
        }),
      }
    );

    expect(saveResponse.status).toBe(200);

    // Complete should fail — no cost basis for positive adjustment
    const completeResponse = await testFetch(
      `/api/stocktakes/${noCostStocktakeId}/complete`,
      {
        method: "POST",
        body: JSON.stringify({ confirmStale: false }),
      }
    );
    const completeBody = await completeResponse.json();

    expect(completeResponse.status).toBe(400);
    expect(completeBody.error).toContain("default purchase price");

    // Verify stocktake is still draft
    const [draftStocktake] = await db
      .select({ status: stocktakes.status })
      .from(stocktakes)
      .where(eq(stocktakes.id, noCostStocktakeId));

    expect(draftStocktake.status).toBe("draft");

    // Verify no stock movements were created
    const relatedMovements = await db
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(eq(stockMovements.referenceId, noCostStocktakeId));

    expect(relatedMovements).toHaveLength(0);

    // Cancel and delete the test material
    const cancelResponse = await testFetch(
      `/api/stocktakes/${noCostStocktakeId}/cancel`,
      { method: "POST" }
    );

    expect(cancelResponse.status).toBe(200);

    const deleteResponse = await deleteItem(noCostMaterialId);
    expect(deleteResponse.status).toBe(200);
  });

  /* ══════════════════════════════════════════════════════════════════
     3. Creates an all-items stocktake and blocks draft item deletion
     ══════════════════════════════════════════════════════════════════ */

  test("creates an all-items stocktake and blocks draft item deletion", async ({
    page,
    db,
  }) => {
    await page.goto("/inventory/stocktakes/new");
    await expect(page.getByText("New Stocktake")).toBeVisible();

    await page
      .locator("#name")
      .pressSequentially(`Paonia Full Count ${runTs}`, { delay: 20 });
    await page
      .locator("#notes")
      .pressSequentially("All-items reconciliation for Paonia Soil Co.", {
        delay: 20,
      });

    await page.getByRole("button", { name: "Create Stocktake" }).click();
    await page.waitForURL(/\/inventory\/stocktakes\/[0-9a-f-]+$/);
    allItemsStocktakeId = getIdFromUrl(page.url());

    // Verify scope and status in DB
    const [stocktake] = await db
      .select()
      .from(stocktakes)
      .where(eq(stocktakes.id, allItemsStocktakeId));

    expect(stocktake.scope).toBe("all");
    expect(stocktake.status).toBe("draft");

    // Verify stocktake lines exist for all active items
    const lines = await db
      .select()
      .from(stocktakeItems)
      .where(eq(stocktakeItems.stocktakeId, allItemsStocktakeId))
      .orderBy(asc(stocktakeItems.sortOrder));

    // 12 materials + 3 products + 1 simple product = 16 items
    // (plus the no-cost material was deleted in test 2, so it should not appear)
    expect(lines.length).toBeGreaterThanOrEqual(16);

    // Verify Coconut Coir is among the lines
    const coconutCoirLine = lines.find(
      (line) => line.itemId === materialIds["Coconut Coir"]
    );
    expect(coconutCoirLine).toBeTruthy();
    expect(parseFloat(coconutCoirLine!.expectedQty)).toBe(
      coconutCoirStartStock
    );

    // Try to delete Coconut Coir — should be blocked by draft stocktake
    const deleteResponse = await deleteItem(materialIds["Coconut Coir"]);
    expect(deleteResponse.status).toBe(400);
  });

  /* ══════════════════════════════════════════════════════════════════
     4. Creates materials-only and products-only stocktakes via API
     ══════════════════════════════════════════════════════════════════ */

  test("creates materials-only and products-only stocktakes via API", async ({
    db,
  }) => {
    const materialsResponse = await testFetch("/api/stocktakes", {
      method: "POST",
      body: JSON.stringify({
        name: `Paonia Materials Count ${runTs}`,
        scope: "material",
        notes: null,
      }),
    });
    const materialsBody = await materialsResponse.json();

    expect(materialsResponse.status).toBe(201);
    materialsOnlyStocktakeId = materialsBody.id;

    const productsResponse = await testFetch("/api/stocktakes", {
      method: "POST",
      body: JSON.stringify({
        name: `Paonia Products Count ${runTs}`,
        scope: "product",
        notes: null,
      }),
    });
    const productsBody = await productsResponse.json();

    expect(productsResponse.status).toBe(201);
    productsOnlyStocktakeId = productsBody.id;

    // Materials-only stocktake should contain only material lines
    const materialLines = await db
      .select({ itemType: stocktakeItems.itemType })
      .from(stocktakeItems)
      .where(eq(stocktakeItems.stocktakeId, materialsOnlyStocktakeId));
    expect(materialLines.length).toBeGreaterThanOrEqual(12);
    expect(materialLines.every((l) => l.itemType === "material")).toBe(true);

    // Products-only stocktake should contain only product lines
    const productLines = await db
      .select({ itemType: stocktakeItems.itemType })
      .from(stocktakeItems)
      .where(eq(stocktakeItems.stocktakeId, productsOnlyStocktakeId));
    expect(productLines.length).toBeGreaterThanOrEqual(4);
    expect(productLines.every((l) => l.itemType === "product")).toBe(true);
  });

  /* ══════════════════════════════════════════════════════════════════
     5. Saves draft counts (Coconut Coir counted 2 short)
     ══════════════════════════════════════════════════════════════════ */

  test("saves draft counts (Coconut Coir counted 2 short)", async ({
    page,
    db,
  }) => {
    const coconutCoirName = withTs("Coconut Coir", ts);

    await page.goto(`/inventory/stocktakes/${allItemsStocktakeId}`);

    // Read Coconut Coir's expected qty from the stocktake line
    const [coconutCoirLine] = await db
      .select({
        id: stocktakeItems.id,
        expectedQty: stocktakeItems.expectedQty,
      })
      .from(stocktakeItems)
      .where(
        and(
          eq(stocktakeItems.stocktakeId, allItemsStocktakeId),
          eq(stocktakeItems.itemId, materialIds["Coconut Coir"])
        )
      );

    const expectedQty = parseFloat(coconutCoirLine.expectedQty);
    const countedQty = expectedQty - 2;

    // Fill the counted value in the UI (2 short of expected)
    const coconutCoirRow = page
      .locator("tbody tr")
      .filter({ hasText: coconutCoirName })
      .first();
    await coconutCoirRow.scrollIntoViewIfNeeded();
    const countInput = coconutCoirRow.getByPlaceholder("Leave blank");
    await expect(countInput).toBeVisible();
    await countInput.click();
    await countInput.fill(String(countedQty));
    await expect(countInput).toHaveValue(String(countedQty));
    await countInput.blur();

    const saveButton = page.getByRole("button", { name: "Save Counts" });
    await expect(saveButton).toBeEnabled({ timeout: 5000 });
    const saveRes = page.waitForResponse(
      (r) => r.url().includes("/api/stocktakes/") && r.request().method() === "PUT"
    );
    await saveButton.click();
    const res = await saveRes;
    expect(res.status(), `Save API returned ${res.status()}`).toBe(200);

    // Poll DB for the counted qty to be saved (15s timeout)
    await expect
      .poll(
        async () => {
          const [line] = await db
            .select({
              countedQty: stocktakeItems.countedQty,
              varianceQty: stocktakeItems.varianceQty,
            })
            .from(stocktakeItems)
            .where(
              and(
                eq(stocktakeItems.stocktakeId, allItemsStocktakeId),
                eq(stocktakeItems.itemId, materialIds["Coconut Coir"])
              )
            );

          return {
            countedQty: line?.countedQty ?? null,
            varianceQty: line?.varianceQty ?? null,
          };
        },
        { timeout: 15_000 }
      )
      .toEqual({
        countedQty: `${countedQty.toFixed(4)}`,
        varianceQty: "-2.0000",
      });

    // Verify uncounted lines remain null (pick a product that has no count)
    const [uncountedLine] = await db
      .select({
        countedQty: stocktakeItems.countedQty,
        varianceQty: stocktakeItems.varianceQty,
      })
      .from(stocktakeItems)
      .where(
        and(
          eq(stocktakeItems.stocktakeId, allItemsStocktakeId),
          eq(stocktakeItems.itemId, productIds[PRODUCTS.NUTE_PACK])
        )
      );

    expect(uncountedLine.countedQty).toBeNull();
    expect(uncountedLine.varianceQty).toBeNull();
  });

  /* ══════════════════════════════════════════════════════════════════
     6. Warns on stale completion, applies variance
     ══════════════════════════════════════════════════════════════════ */

  test("warns on stale completion, applies variance", async ({
    page,
    db,
  }) => {
    const coconutCoirName = withTs("Coconut Coir", ts);

    // Bump Coconut Coir stock by 3 via updateItem to trigger stale detection
    const materialUpdate = await updateItem(materialIds["Coconut Coir"], {
      name: coconutCoirName,
      sku: `MAT-COCO-${ts}`,
      category: withTs("Bases", ts),
      description: "Premium coco coir, triple-washed",
      defaultPurchasePrice: "4.50",
      defaultSellingPrice: null,
      safetyStock: "20",
      stock: String(coconutCoirStartStock + 3),
      bom: [],
    });

    expect(materialUpdate.status).toBe(200);

    // Navigate to the stocktake detail page
    await page.goto(`/inventory/stocktakes/${allItemsStocktakeId}`);

    // Click "Complete" — should trigger stale warning
    await page.getByRole("button", { name: "Complete" }).click();

    await expect(
      page.getByText("Complete with changed stock?")
    ).toBeVisible();

    // Confirm completion with live stock
    await page
      .getByRole("button", { name: "Complete With Live Stock" })
      .click();

    // Poll for completed status
    await expect
      .poll(
        async () => {
          const [stocktake] = await db
            .select({
              status: stocktakes.status,
              completedAt: stocktakes.completedAt,
            })
            .from(stocktakes)
            .where(eq(stocktakes.id, allItemsStocktakeId));

          return {
            status: stocktake?.status ?? null,
            completedAt: stocktake?.completedAt != null,
          };
        },
        { timeout: 15_000 }
      )
      .toEqual({
        status: "completed",
        completedAt: true,
      });

    // Verify appliedDeltaQty on Coconut Coir line
    // Expected was coconutCoirStartStock, counted was (coconutCoirStartStock - 2),
    // but live stock was bumped to (coconutCoirStartStock + 3).
    // appliedDelta = counted - liveStock = (coconutCoirStartStock - 2) - (coconutCoirStartStock + 3) = -5
    const lines = await db
      .select()
      .from(stocktakeItems)
      .where(eq(stocktakeItems.stocktakeId, allItemsStocktakeId))
      .orderBy(asc(stocktakeItems.sortOrder));

    const coconutCoirLine = lines.find(
      (line) => line.itemId === materialIds["Coconut Coir"]
    );
    const nutePackLine = lines.find(
      (line) => line.itemId === productIds[PRODUCTS.NUTE_PACK]
    );

    expect(coconutCoirLine?.countedQty).toBe(
      `${(coconutCoirStartStock - 2).toFixed(4)}`
    );
    expect(coconutCoirLine?.varianceQty).toBe("-2.0000");
    expect(coconutCoirLine?.appliedDeltaQty).toBe("-5.0000");

    // Uncounted lines should have null appliedDeltaQty
    expect(nutePackLine?.countedQty).toBeNull();
    expect(nutePackLine?.appliedDeltaQty).toBeNull();

    // Verify Coconut Coir's total stock is now the counted value
    const [coconutCoirStock] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${lots.quantity}), 0)`,
      })
      .from(lots)
      .where(eq(lots.itemId, materialIds["Coconut Coir"]));

    expect(parseFloat(coconutCoirStock.total)).toBe(
      coconutCoirStartStock - 2
    );

    // Verify stock movement was created
    const stocktakeMovements = await db
      .select({
        quantity: stockMovements.quantity,
        movementType: stockMovements.movementType,
        referenceType: stockMovements.referenceType,
        referenceId: stockMovements.referenceId,
      })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.itemId, materialIds["Coconut Coir"]),
          eq(stockMovements.movementType, "stocktake_adjustment"),
          eq(stockMovements.referenceId, allItemsStocktakeId)
        )
      );

    expect(stocktakeMovements).toHaveLength(1);
    expect(stocktakeMovements[0].referenceType).toBe("stocktake");
    expect(parseFloat(stocktakeMovements[0].quantity)).toBe(-5);
  });

  /* ══════════════════════════════════════════════════════════════════
     7. Cancels a draft stocktake without mutating inventory
     ══════════════════════════════════════════════════════════════════ */

  test("cancels a draft stocktake without mutating inventory", async ({
    db,
  }) => {
    const cancelResponse = await testFetch(
      `/api/stocktakes/${productsOnlyStocktakeId}/cancel`,
      { method: "POST" }
    );

    expect(cancelResponse.status).toBe(200);

    // Verify status is cancelled
    const [cancelledStocktake] = await db
      .select()
      .from(stocktakes)
      .where(eq(stocktakes.id, productsOnlyStocktakeId));

    expect(cancelledStocktake.status).toBe("cancelled");
    expect(cancelledStocktake.cancelledAt).not.toBeNull();

    // Verify no stock movements were created for this stocktake
    const cancelledMovements = await db
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(eq(stockMovements.referenceId, productsOnlyStocktakeId));

    expect(cancelledMovements).toHaveLength(0);

    // Verify product stock unchanged (products should still be 0 from purchasing)
    const [nutePackStock] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${lots.quantity}), 0)`,
      })
      .from(lots)
      .where(eq(lots.itemId, productIds[PRODUCTS.NUTE_PACK]));

    expect(parseFloat(nutePackStock.total)).toBe(0);
  });

  /* ══════════════════════════════════════════════════════════════════
     8. Derives product stock-adjustment cost from BOM
     ══════════════════════════════════════════════════════════════════ */

  test("derives product stock-adjustment cost from BOM", async ({ db }) => {
    // Update Pro Base Coco with stock=2 and its BOM
    const proBaseBom = PRO_BASE_BOM.map((entry) => ({
      componentId: materialIds[entry.component],
      quantity: entry.quantity,
    }));

    const productAdjustment = await updateItem(
      productIds[PRODUCTS.PRO_BASE],
      {
        name: withTs(PRODUCTS.PRO_BASE, ts),
        sku: `PROD-PROBASE-${ts}`,
        category: null,
        description: null,
        defaultPurchasePrice: null,
        defaultSellingPrice: null,
        safetyStock: "0",
        stock: "2",
        bom: proBaseBom,
      }
    );

    expect(productAdjustment.status).toBe(200);

    // Verify lot has BOM-derived cost
    const productLots = await db
      .select({
        quantity: lots.quantity,
        costPerUnit: lots.costPerUnit,
      })
      .from(lots)
      .where(eq(lots.itemId, productIds[PRODUCTS.PRO_BASE]))
      .orderBy(asc(lots.receivedAt), asc(lots.id));

    expect(productLots).toHaveLength(1);
    expect(productLots[0].quantity).toBe("2.0000");
    expect(productLots[0].costPerUnit).not.toBeNull();
    expect(parseFloat(productLots[0].costPerUnit!)).toBeGreaterThan(0);
  });

  /* ══════════════════════════════════════════════════════════════════
     9. Creates product opening stock using BOM-derived cost
     ══════════════════════════════════════════════════════════════════ */

  test("creates product opening stock using BOM-derived cost", async ({
    db,
  }) => {
    const unitId = getUnitId();
    const openingStockName = `Stocktake BOM Opening ${runTs}`;

    const createResponse = await createItem({
      name: openingStockName,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `STK-PROD-BOM-${runTs}`,
      category: null,
      description: "Product with opening stock costed from its BOM",
      defaultPurchasePrice: null,
      defaultSellingPrice: "18.00",
      stock: "1",
      safetyStock: "0",
      bom: [
        {
          componentId: materialIds["Coconut Coir"],
          quantity: "2",
        },
      ],
    });

    expect(createResponse.status).toBe(201);

    const openingStockProductId = createResponse.body.id as string;

    const productLots = await db
      .select({
        quantity: lots.quantity,
        costPerUnit: lots.costPerUnit,
      })
      .from(lots)
      .where(eq(lots.itemId, openingStockProductId));

    expect(productLots).toHaveLength(1);
    expect(productLots[0].quantity).toBe("1.0000");
    expect(productLots[0].costPerUnit).not.toBeNull();
    expect(parseFloat(productLots[0].costPerUnit!)).toBeGreaterThan(0);
  });
});
