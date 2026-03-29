import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { test, expect, getIdFromUrl } from "./fixtures";
import {
  items,
  lots,
  stockMovements,
  stocktakeItems,
  stocktakes,
} from "../../lib/db/schema";
import {
  createItem,
  deleteItem,
  getUnitId,
  testFetch,
  updateItem,
} from "../helpers/api";

test.describe("Stocktake flow", () => {
  test.describe.configure({ mode: "serial" });

  const ts = Date.now();
  const unitId = getUnitId();

  const category = `Stocktake ${ts}`;
  const materialName = `Stocktake Bark ${ts}`;
  const productName = `Stocktake Mix ${ts}`;
  const renamedProductName = `${productName} Updated`;
  const noCostMaterialName = `Stocktake No Cost ${ts}`;

  let materialId: string;
  let productId: string;
  let stocktakeId: string;
  let materialsOnlyStocktakeId: string;
  let productsOnlyStocktakeId: string;

  test("creates material and product fixtures", async ({ db }) => {
    expect(unitId).toBeTruthy();

    const materialCreate = await createItem({
      name: materialName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `STK-MAT-${ts}`,
      category,
      description: "Primary stocktake material",
      defaultPurchasePrice: "2.50",
      defaultSellingPrice: null,
      stock: "5",
      safetyStock: "0",
      bom: [],
    });

    expect(materialCreate.status).toBe(201);
    materialId = materialCreate.body.id;

    const productCreate = await createItem({
      name: productName,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `STK-PROD-${ts}`,
      category,
      description: "Primary stocktake product",
      defaultPurchasePrice: null,
      defaultSellingPrice: "12.00",
      stock: "0",
      safetyStock: "0",
      bom: [],
    });

    expect(productCreate.status).toBe(201);
    productId = productCreate.body.id;

    const createdItems = await db
      .select({
        id: items.id,
      })
      .from(items)
      .where(and(eq(items.category, category), inArray(items.id, [materialId, productId])));

    expect(createdItems).toHaveLength(2);
  });

  test("requires a default purchase price for positive stock additions", async ({
    db,
  }) => {
    test.slow();

    const noCostInitialCreate = await createItem({
      name: `${noCostMaterialName} Initial`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `STK-NOCOST-INIT-${ts}`,
      category,
      description: "Should fail when creating positive stock without cost",
      defaultPurchasePrice: null,
      defaultSellingPrice: null,
      stock: "1",
      safetyStock: "0",
      bom: [],
    });

    expect(noCostInitialCreate.status).toBe(400);
    expect(noCostInitialCreate.body?.errors?.defaultPurchasePrice?.[0]).toContain(
      "default purchase price"
    );

    const noCostCreate = await createItem({
      name: noCostMaterialName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `STK-NOCOST-${ts}`,
      category,
      description: "Zero-stock material without a default purchase price",
      defaultPurchasePrice: null,
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });

    expect(noCostCreate.status).toBe(201);
    const noCostMaterialId = noCostCreate.body.id;

    const noCostUpdate = await updateItem(noCostMaterialId, {
      name: noCostMaterialName,
      sku: `STK-NOCOST-${ts}`,
      category,
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

    const stocktakeResponse = await testFetch("/api/stocktakes", {
      method: "POST",
      body: JSON.stringify({
        name: `No Cost Count ${ts}`,
        scope: "material",
        notes: null,
      }),
    });
    const stocktakeBody = await stocktakeResponse.json();

    expect(stocktakeResponse.status).toBe(201);
    const noCostStocktakeId = stocktakeBody.id;

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

    const saveResponse = await testFetch(`/api/stocktakes/${noCostStocktakeId}`, {
      method: "PUT",
      body: JSON.stringify({
        lines: [
          {
            lineId: noCostLine.id,
            countedQty: "1",
          },
        ],
      }),
    });

    expect(saveResponse.status).toBe(200);

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

    const [draftStocktake] = await db
      .select({ status: stocktakes.status })
      .from(stocktakes)
      .where(eq(stocktakes.id, noCostStocktakeId));

    expect(draftStocktake.status).toBe("draft");

    const relatedMovements = await db
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(eq(stockMovements.referenceId, noCostStocktakeId));

    expect(relatedMovements).toHaveLength(0);

    const cancelResponse = await testFetch(`/api/stocktakes/${noCostStocktakeId}/cancel`, {
      method: "POST",
    });

    expect(cancelResponse.status).toBe(200);

    const deleteResponse = await deleteItem(noCostMaterialId);
    expect(deleteResponse.status).toBe(200);
  });

  test("creates an all-items stocktake and blocks draft item deletion", async ({
    page,
    db,
  }) => {
    const nameInput = page.locator("#name");

    await page.goto("/inventory/stocktakes/new");
    await expect(page.getByText("New Stocktake")).toBeVisible();

    await page.locator("#notes").pressSequentially("Initial all-items reconciliation.", {
      delay: 20,
    });
    await nameInput.pressSequentially(`Full Count ${ts}`, { delay: 20 });
    await expect(nameInput).toHaveValue(`Full Count ${ts}`);

    await page.getByRole("button", { name: "Create Stocktake" }).click();
    await page.waitForURL(/\/inventory\/stocktakes\/[0-9a-f-]+$/);
    stocktakeId = getIdFromUrl(page.url());

    const [stocktake] = await db
      .select()
      .from(stocktakes)
      .where(eq(stocktakes.id, stocktakeId));

    expect(stocktake.scope).toBe("all");
    expect(stocktake.status).toBe("draft");

    const lines = await db
      .select()
      .from(stocktakeItems)
      .where(eq(stocktakeItems.stocktakeId, stocktakeId))
      .orderBy(asc(stocktakeItems.sortOrder));

    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.map((line) => line.itemId)).toEqual(
      expect.arrayContaining([materialId, productId])
    );

    const materialLine = lines.find((line) => line.itemId === materialId);
    const productLine = lines.find((line) => line.itemId === productId);

    expect(materialLine?.expectedQty).toBe("5.0000");
    expect(productLine?.expectedQty).toBe("0.0000");

    const deleteResponse = await deleteItem(materialId);
    expect(deleteResponse.status).toBe(400);
    expect(deleteResponse.body?.error).toContain("draft stocktakes");
  });

  test("creates materials-only and products-only stocktakes via API", async ({ db }) => {
    const materialsResponse = await testFetch("/api/stocktakes", {
      method: "POST",
      body: JSON.stringify({
        name: `Materials Count ${ts}`,
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
        name: `Products Count ${ts}`,
        scope: "product",
        notes: null,
      }),
    });
    const productsBody = await productsResponse.json();

    expect(productsResponse.status).toBe(201);
    productsOnlyStocktakeId = productsBody.id;

    const materialLines = await db
      .select({ itemId: stocktakeItems.itemId, itemType: stocktakeItems.itemType })
      .from(stocktakeItems)
      .where(eq(stocktakeItems.stocktakeId, materialsOnlyStocktakeId));
    expect(materialLines.length).toBeGreaterThanOrEqual(1);
    expect(materialLines.map((line) => line.itemId)).toContain(materialId);
    expect(materialLines.every((line) => line.itemType === "material")).toBe(true);

    const productLines = await db
      .select({ itemId: stocktakeItems.itemId, itemType: stocktakeItems.itemType })
      .from(stocktakeItems)
      .where(eq(stocktakeItems.stocktakeId, productsOnlyStocktakeId));
    expect(productLines.length).toBeGreaterThanOrEqual(1);
    expect(productLines.map((line) => line.itemId)).toContain(productId);
    expect(productLines.every((line) => line.itemType === "product")).toBe(true);
  });

  test("saves draft counts and leaves blank lines unchanged", async ({ db }) => {
    const lines = await db
      .select({
        id: stocktakeItems.id,
        itemId: stocktakeItems.itemId,
      })
      .from(stocktakeItems)
      .where(eq(stocktakeItems.stocktakeId, stocktakeId))
      .orderBy(asc(stocktakeItems.sortOrder));

    const materialLine = lines.find((line) => line.itemId === materialId);
    const productLine = lines.find((line) => line.itemId === productId);

    expect(materialLine).toBeTruthy();
    expect(productLine).toBeTruthy();

    const saveResponse = await testFetch(`/api/stocktakes/${stocktakeId}`, {
      method: "PUT",
      body: JSON.stringify({
        lines: [
          {
            lineId: materialLine!.id,
            countedQty: "4",
          },
        ],
      }),
    });

    expect(saveResponse.status).toBe(200);

    await expect
      .poll(
        async () => {
          const lines = await db
            .select()
            .from(stocktakeItems)
            .where(eq(stocktakeItems.stocktakeId, stocktakeId))
            .orderBy(asc(stocktakeItems.sortOrder));

          const materialLine = lines.find((line) => line.itemId === materialId);
          const productLine = lines.find((line) => line.itemId === productId);

          return {
            materialCountedQty: materialLine?.countedQty ?? null,
            materialVarianceQty: materialLine?.varianceQty ?? null,
            productCountedQty: productLine?.countedQty ?? null,
            productVarianceQty: productLine?.varianceQty ?? null,
          };
        },
        { timeout: 30_000 }
      )
      .toEqual({
        materialCountedQty: "4.0000",
        materialVarianceQty: "-1.0000",
        productCountedQty: null,
        productVarianceQty: null,
      });
  });

  test("warns on stale completion, applies deltas, and preserves snapshots", async ({
    page,
    db,
  }) => {
    const materialUpdate = await updateItem(materialId, {
      name: materialName,
      sku: `STK-MAT-${ts}`,
      category,
      description: "Primary stocktake material",
      defaultPurchasePrice: "2.50",
      defaultSellingPrice: null,
      safetyStock: "0",
      stock: "7",
      bom: [],
    });

    expect(materialUpdate.status).toBe(200);

    const staleCompleteResponse = await testFetch(
      `/api/stocktakes/${stocktakeId}/complete`,
      {
        method: "POST",
        body: JSON.stringify({ confirmStale: false }),
      }
    );
    const staleCompleteBody = await staleCompleteResponse.json();

    expect(staleCompleteResponse.status).toBe(409);
    expect(staleCompleteBody.stale?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemId: materialId,
          expectedQty: "5",
          currentQty: "7",
          countedQty: "4.0000",
        }),
      ])
    );

    const completeResponse = await testFetch(`/api/stocktakes/${stocktakeId}/complete`, {
      method: "POST",
      body: JSON.stringify({ confirmStale: true }),
    });

    expect(completeResponse.status).toBe(200);
    await expect
      .poll(async () => {
        const [stocktake] = await db
          .select({
            status: stocktakes.status,
            completedAt: stocktakes.completedAt,
          })
          .from(stocktakes)
          .where(eq(stocktakes.id, stocktakeId));

        return {
          status: stocktake?.status ?? null,
          completedAt: stocktake?.completedAt != null,
        };
      })
      .toEqual({
        status: "completed",
        completedAt: true,
      });

    const lines = await db
      .select()
      .from(stocktakeItems)
      .where(eq(stocktakeItems.stocktakeId, stocktakeId))
      .orderBy(asc(stocktakeItems.sortOrder));

    const materialLine = lines.find((line) => line.itemId === materialId);
    const productLine = lines.find((line) => line.itemId === productId);

    expect(materialLine?.countedQty).toBe("4.0000");
    expect(materialLine?.varianceQty).toBe("-1.0000");
    expect(materialLine?.appliedDeltaQty).toBe("-3.0000");
    expect(productLine?.countedQty).toBeNull();
    expect(productLine?.appliedDeltaQty).toBeNull();

    const [materialStock] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${lots.quantity}), 0)`,
      })
      .from(lots)
      .where(eq(lots.itemId, materialId));

    const [productStock] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${lots.quantity}), 0)`,
      })
      .from(lots)
      .where(eq(lots.itemId, productId));

    expect(parseFloat(materialStock.total)).toBe(4);
    expect(parseFloat(productStock.total)).toBe(0);

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
          eq(stockMovements.itemId, materialId),
          eq(stockMovements.movementType, "stocktake_adjustment"),
          eq(stockMovements.referenceId, stocktakeId)
        )
      );

    expect(stocktakeMovements).toHaveLength(1);
    expect(stocktakeMovements[0].referenceType).toBe("stocktake");
    expect(parseFloat(stocktakeMovements[0].quantity)).toBe(-3);

    const productRename = await updateItem(productId, {
      name: renamedProductName,
      sku: `STK-PROD-${ts}`,
      category,
      description: "Primary stocktake product",
      defaultPurchasePrice: null,
      defaultSellingPrice: "12.00",
      safetyStock: "0",
      stock: "0",
      bom: [],
    });

    expect(productRename.status).toBe(200);

    await page.goto(`/inventory/stocktakes/${stocktakeId}`);
    await expect(page.getByText(productName)).toBeVisible();
    await expect(page.getByText(renamedProductName)).not.toBeVisible();
  });

  test("cancels a draft stocktake without mutating inventory", async ({ db }) => {
    const cancelResponse = await testFetch(
      `/api/stocktakes/${productsOnlyStocktakeId}/cancel`,
      {
        method: "POST",
      }
    );

    expect(cancelResponse.status).toBe(200);

    const [cancelledStocktake] = await db
      .select()
      .from(stocktakes)
      .where(eq(stocktakes.id, productsOnlyStocktakeId));

    expect(cancelledStocktake.status).toBe("cancelled");
    expect(cancelledStocktake.cancelledAt).not.toBeNull();

    const [productStock] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${lots.quantity}), 0)`,
      })
      .from(lots)
      .where(eq(lots.itemId, productId));

    expect(parseFloat(productStock.total)).toBe(0);

    const cancelledMovements = await db
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(eq(stockMovements.referenceId, productsOnlyStocktakeId));

    expect(cancelledMovements).toHaveLength(0);
  });

  test("derives product stock-adjustment cost from the updated BOM", async ({ db }) => {
    const productAdjustment = await updateItem(productId, {
      name: renamedProductName,
      sku: `STK-PROD-${ts}`,
      category,
      description: "Primary stocktake product",
      defaultPurchasePrice: null,
      defaultSellingPrice: "12.00",
      safetyStock: "0",
      stock: "2",
      bom: [{ componentId: materialId, quantity: "2" }],
    });

    expect(productAdjustment.status).toBe(200);

    const productLots = await db
      .select({
        quantity: lots.quantity,
        costPerUnit: lots.costPerUnit,
      })
      .from(lots)
      .where(eq(lots.itemId, productId))
      .orderBy(asc(lots.receivedAt), asc(lots.id));

    expect(productLots).toHaveLength(1);
    expect(productLots[0].quantity).toBe("2.0000");
    expect(productLots[0].costPerUnit).toBe("5.0000");
  });

  test("creates product opening stock using BOM-derived cost", async ({ db }) => {
    const openingStockName = `Stocktake BOM Opening ${ts}`;
    const createResponse = await createItem({
      name: openingStockName,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `STK-PROD-BOM-${ts}`,
      category,
      description: "Product with opening stock costed from its BOM",
      defaultPurchasePrice: null,
      defaultSellingPrice: "18.00",
      stock: "1",
      safetyStock: "0",
      bom: [{ componentId: materialId, quantity: "2" }],
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
    expect(productLots[0].costPerUnit).toBe("5.0000");
  });
});
