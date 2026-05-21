import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { test, expect, filterList, getIdFromUrl } from "../fixtures";
import {
  inventoryEvents,
  inventoryLotBalances,
  items,
  lots,
  stocktakeLotItems,
  stocktakeItems,
  stocktakes,
} from "../../../lib/db/schema";
import {
  createItem,
  createUnit,
  getUnitId,
  testFetch,
  updateItem,
} from "../../helpers/api";
import { buildStocktakeCategoryScope } from "../../../lib/schemas/stocktakes";

test.describe("Stocktake flow", () => {
  test.describe.configure({ mode: "serial" });

  const ts = Date.now();
  const unitId = getUnitId();

  const category = `Stocktake ${ts}`;
  const materialCategory = `Stocktake Material ${ts}`;
  const productCategory = `Stocktake Product ${ts}`;
  const materialName = `Stocktake Bark ${ts}`;
  const productName = `Stocktake Mix ${ts}`;
  const renamedProductName = `${productName} Updated`;
  const noCostMaterialName = `Stocktake No Cost ${ts}`;

  let materialId: string;
  let productId: string;
  let stocktakeId: string;
  let materialCategoryStocktakeId: string;
  let productCategoryStocktakeId: string;

  test("creates material and product fixtures", async ({ db }) => {
    expect(unitId).toBeTruthy();

    const materialCreate = await createItem({
      name: materialName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `STK-MAT-${ts}`,
      category: materialCategory,
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
      category: productCategory,
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
      .where(
        and(
          inArray(items.category, [materialCategory, productCategory]),
          inArray(items.id, [materialId, productId])
        )
      );

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
      manufacturingMode: "discrete",
      expectedBatchYield: null,
      safetyStock: "0",
      stock: "2",
      bom: [],
    });

    expect(noCostUpdate.status).toBe(400);
    const updateCostError =
      noCostUpdate.body?.errors?.defaultPurchasePrice?.[0] ??
      noCostUpdate.body?.errors?.stock?.[0] ??
      noCostUpdate.body?.error;
    expect(updateCostError).toMatch(/default purchase price|explicit unit cost/i);

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

    const relatedEvents = await db
      .select({ id: inventoryEvents.id })
      .from(inventoryEvents)
      .where(sql`${inventoryEvents.metadata}->>'stocktakeId' = ${noCostStocktakeId}`);

    expect(relatedEvents).toHaveLength(0);

    const stocktakeDeleteResponse = await testFetch("/api/stocktakes", {
      method: "DELETE",
      body: JSON.stringify({ ids: [noCostStocktakeId] }),
    });
    const stocktakeDeleteBody = await stocktakeDeleteResponse.text().catch(() => "");

    expect(stocktakeDeleteResponse.status, stocktakeDeleteBody).toBe(200);

    const deleteResponse = await testFetch(`/api/item-cards/${noCostMaterialId}`, {
      method: "DELETE",
    });
    const deleteBody = await deleteResponse.json().catch(() => null);
    expect(deleteResponse.status, JSON.stringify(deleteBody)).toBe(200);
    expect(deleteBody?.deleted).toBe(true);
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
    await nameInput.fill(`Full Count ${ts}`);
    await expect(nameInput).toHaveValue(`Full Count ${ts}`);

    await page.getByRole("button", { name: "Create Stocktake" }).click();
    await page.waitForURL(/\/inventory\/stocktakes\/[0-9a-f-]+$/);
    stocktakeId = getIdFromUrl(page.url());
    await expect(page.locator("main").getByText("Draft", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("All Items")).toBeVisible();
    await expect(page.getByText("Initial all-items reconciliation.")).toBeVisible();
    await expect(page.locator("table").first()).toContainText(materialName);
    await expect(page.locator("table").first()).toContainText(productName);

    await page.reload();
    await expect(page.locator("main").getByText("Draft", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("All Items")).toBeVisible();
    await expect(page.getByText("Initial all-items reconciliation.")).toBeVisible();
    await expect(page.locator("table").first()).toContainText(materialName);
    await expect(page.locator("table").first()).toContainText(productName);

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
    await expect(page.getByText(`0 / ${lines.length}`)).toBeVisible();

    const deleteResponse = await testFetch(`/api/item-cards/${productId}`, {
      method: "DELETE",
    });
    const deleteBody = await deleteResponse.json().catch(() => null);
    expect(deleteResponse.status, JSON.stringify(deleteBody)).toBe(400);
    expect(deleteBody?.error ?? "").toMatch(/draft stocktakes?/i);

    await page.goto("/inventory/stocktakes");
    await filterList(page, "Search stocktakes", `Full Count ${ts}`);
    const stocktakeRow = page
      .locator(".ag-center-cols-container [role='row']")
      .filter({ hasText: `Full Count ${ts}` })
      .first();
    await expect(stocktakeRow).toContainText("All");
    await expect(stocktakeRow).toContainText("Draft");
    await expect(stocktakeRow).toContainText(`0 / ${lines.length}`);
  });

  test("creates category-scoped stocktakes via API", async ({ page, db }) => {
    const materialsResponse = await testFetch("/api/stocktakes", {
      method: "POST",
      body: JSON.stringify({
        name: `Material Category Count ${ts}`,
        scope: buildStocktakeCategoryScope("material", materialCategory),
        notes: null,
      }),
    });
    const materialsBody = await materialsResponse.json();

    expect(materialsResponse.status).toBe(201);
    materialCategoryStocktakeId = materialsBody.id;

    const productsResponse = await testFetch("/api/stocktakes", {
      method: "POST",
      body: JSON.stringify({
        name: `Product Category Count ${ts}`,
        scope: buildStocktakeCategoryScope("product", productCategory),
        notes: null,
      }),
    });
    const productsBody = await productsResponse.json();

    expect(productsResponse.status).toBe(201);
    productCategoryStocktakeId = productsBody.id;

    const materialLines = await db
      .select({ itemId: stocktakeItems.itemId, itemType: stocktakeItems.itemType })
      .from(stocktakeItems)
      .where(eq(stocktakeItems.stocktakeId, materialCategoryStocktakeId));
    expect(materialLines).toHaveLength(1);
    expect(materialLines.map((line) => line.itemId)).toEqual([materialId]);
    expect(materialLines.every((line) => line.itemType === "material")).toBe(true);

    const productLines = await db
      .select({ itemId: stocktakeItems.itemId, itemType: stocktakeItems.itemType })
      .from(stocktakeItems)
      .where(eq(stocktakeItems.stocktakeId, productCategoryStocktakeId));
    expect(productLines).toHaveLength(1);
    expect(productLines.map((line) => line.itemId)).toEqual([productId]);
    expect(productLines.every((line) => line.itemType === "product")).toBe(true);

    await page.goto("/inventory/stocktakes");
    await filterList(page, "Search stocktakes", String(ts));
    const materialCategoryRow = page
      .locator(".ag-center-cols-container [role='row']")
      .filter({ hasText: `Material Category Count ${ts}` })
      .first();
    const productCategoryRow = page
      .locator(".ag-center-cols-container [role='row']")
      .filter({ hasText: `Product Category Count ${ts}` })
      .first();
    await expect(
      materialCategoryRow
    ).toContainText(`Materials: ${materialCategory}`);
    await expect(productCategoryRow).toContainText(`Products: ${productCategory}`);

    await page.goto(`/inventory/stocktakes/${materialCategoryStocktakeId}`);
    await expect(page.getByRole("heading", { name: `Material Category Count ${ts}` })).toBeVisible();
    await expect(page.getByText(`Materials: ${materialCategory}`)).toBeVisible();
    await expect(page.locator("table").first()).toContainText(materialName);

    await page.goto(`/inventory/stocktakes/${productCategoryStocktakeId}`);
    await expect(page.getByRole("heading", { name: `Product Category Count ${ts}` })).toBeVisible();
    await expect(page.getByText(`Products: ${productCategory}`)).toBeVisible();
    await expect(page.locator("table").first()).toContainText(productName);
  });

  test("clones stocktake line items from the table actions menu", async ({
    page,
    db,
  }) => {
    const [sourceLine] = await db
      .select({ id: stocktakeItems.id })
      .from(stocktakeItems)
      .where(eq(stocktakeItems.stocktakeId, materialCategoryStocktakeId));
    expect(sourceLine).toBeTruthy();

    const saveResponse = await testFetch(`/api/stocktakes/${materialCategoryStocktakeId}`, {
      method: "PUT",
      body: JSON.stringify({
        lines: [{ lineId: sourceLine!.id, countedQty: "3" }],
      }),
    });
    expect(saveResponse.status).toBe(200);

    await page.goto("/inventory/stocktakes");
    await filterList(page, "Search stocktakes", `Material Category Count ${ts}`);
    const sourceActions = page.getByRole("button", {
      name: `More actions for Material Category Count ${ts}`,
    });

    const [cloneResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response
            .url()
            .endsWith(`/api/stocktakes/${materialCategoryStocktakeId}/clone`)
      ),
      sourceActions
        .click()
        .then(() => page.getByRole("menuitem", { name: "Clone" }).click()),
    ]);

    expect(cloneResponse.status()).toBe(201);
    await page.waitForURL(/\/inventory\/stocktakes\/[0-9a-f-]+$/);
    const clonedStocktakeId = getIdFromUrl(page.url());

    const clonedLines = await db
      .select({
        itemId: stocktakeItems.itemId,
        countedQty: stocktakeItems.countedQty,
      })
      .from(stocktakeItems)
      .where(eq(stocktakeItems.stocktakeId, clonedStocktakeId));

    expect(clonedLines).toEqual([
      {
        itemId: materialId,
        countedQty: null,
      },
    ]);
  });

  test("saves draft counts sparsely, supports clearing counts, and leaves blank lines unchanged", async ({
    page,
    db,
  }) => {
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

    const clearResponse = await testFetch(`/api/stocktakes/${stocktakeId}`, {
      method: "PUT",
      body: JSON.stringify({
        lines: [
          {
            lineId: materialLine!.id,
            countedQty: null,
          },
        ],
      }),
    });

    expect(clearResponse.status).toBe(200);

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
        materialCountedQty: null,
        materialVarianceQty: null,
        productCountedQty: null,
        productVarianceQty: null,
      });

    const restoreResponse = await testFetch(`/api/stocktakes/${stocktakeId}`, {
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

    expect(restoreResponse.status).toBe(200);

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

    await page.goto(`/inventory/stocktakes/${stocktakeId}`);
    const materialRow = page.locator("tbody tr").filter({ hasText: materialName });
    const productRow = page.locator("tbody tr").filter({ hasText: productName });
    await expect(materialRow.getByRole("textbox")).toHaveValue("4");
    await expect(productRow.getByRole("textbox")).toHaveValue("");

    await page.reload();
    await expect(materialRow.getByRole("textbox")).toHaveValue("4");
    await expect(productRow.getByRole("textbox")).toHaveValue("");
  });

  test("completes dirty counts with a sparse save and no movement when live stock already matches", async ({
    page,
    db,
  }) => {
    const response = await testFetch("/api/stocktakes", {
      method: "POST",
      body: JSON.stringify({
        name: `One Click Count ${ts}`,
        scope: "all",
        notes: null,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    const oneClickStocktakeId = body.id as string;

    const lines = await db
      .select({
        id: stocktakeItems.id,
        itemId: stocktakeItems.itemId,
      })
      .from(stocktakeItems)
      .where(eq(stocktakeItems.stocktakeId, oneClickStocktakeId))
      .orderBy(asc(stocktakeItems.sortOrder));

    expect(lines.length).toBeGreaterThanOrEqual(2);

    const materialLine = lines.find((line) => line.itemId === materialId);
    const productLine = lines.find((line) => line.itemId === productId);

    expect(materialLine).toBeTruthy();
    expect(productLine).toBeTruthy();

    const [materialLotLine] = await db
      .select()
      .from(stocktakeLotItems)
      .where(eq(stocktakeLotItems.stocktakeItemId, materialLine!.id));

    await page.goto(`/inventory/stocktakes/${oneClickStocktakeId}`);

    const materialRow = page.locator("tbody tr").filter({ hasText: materialName });
    if (materialLotLine) {
      await materialRow.locator("xpath=following-sibling::tr[1]").getByRole("textbox").fill("5");
    } else {
      await materialRow.getByRole("textbox").fill("5");
    }
    await expect(page.getByRole("button", { name: "Complete" })).toBeEnabled();

    const saveRequestPromise = page.waitForRequest(
      (request) =>
        request.method() === "PUT" &&
        request.url().endsWith(`/api/stocktakes/${oneClickStocktakeId}`)
    );
    const completeRequestPromise = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().endsWith(`/api/stocktakes/${oneClickStocktakeId}/complete`)
    );

    await page.getByRole("button", { name: "Complete" }).click();

    const saveRequest = await saveRequestPromise;
    const completeRequest = await completeRequestPromise;

    expect(JSON.parse(saveRequest.postData() ?? "{}")).toEqual(
      materialLotLine
        ? {
            lines: [],
            lotLines: [
              {
                lotLineId: materialLotLine.id,
                countedQty: "5",
              },
            ],
          }
        : {
            lines: [
              {
                lineId: materialLine!.id,
                countedQty: "5",
              },
            ],
            lotLines: [],
          }
    );
    expect(JSON.parse(completeRequest.postData() ?? "{}")).toEqual({
      confirmStale: false,
    });

    await expect
      .poll(
        async () => {
          const [stocktake] = await db
            .select({ status: stocktakes.status })
            .from(stocktakes)
            .where(eq(stocktakes.id, oneClickStocktakeId));

          return stocktake?.status ?? null;
        },
        { timeout: 30_000 }
      )
      .toBe("completed");

    const savedLines = await db
      .select()
      .from(stocktakeItems)
      .where(eq(stocktakeItems.stocktakeId, oneClickStocktakeId))
      .orderBy(asc(stocktakeItems.sortOrder));

    const savedMaterialLine = savedLines.find((line) => line.itemId === materialId);
    const savedProductLine = savedLines.find((line) => line.itemId === productId);

    expect(savedMaterialLine?.countedQty).toBe("5.0000");
    expect(savedMaterialLine?.varianceQty).toBe("0.0000");
    expect(savedMaterialLine?.appliedDeltaQty).toBe("0.0000");
    expect(savedProductLine?.countedQty).toBeNull();
    expect(savedProductLine?.varianceQty).toBeNull();
    expect(savedProductLine?.appliedDeltaQty).toBeNull();

    const [materialStock] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${lots.quantity}), 0)`,
      })
      .from(lots)
      .where(eq(lots.itemId, materialId));

    expect(parseFloat(materialStock.total)).toBe(5);

    const stocktakeVerificationEvents = await db
      .select({ eventType: inventoryEvents.eventType })
      .from(inventoryEvents)
      .where(sql`${inventoryEvents.metadata}->>'stocktakeId' = ${oneClickStocktakeId}`);

    expect(
      stocktakeVerificationEvents.filter(
        (event) => event.eventType === "stocktake_verification"
      )
    ).toHaveLength(1);
    expect(
      stocktakeVerificationEvents.filter((event) =>
        ["stocktake_gain", "stocktake_loss"].includes(event.eventType)
      )
    ).toHaveLength(0);

    await expect(page.locator("main").getByText("Completed", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(`1 / ${savedLines.length}`)).toBeVisible();
    await expect(page.locator("table").first()).toContainText(materialName);
    await expect(page.locator("table").first()).toContainText("5");
    await expect(page.locator("table").first()).toContainText("0");
  });

  test("completes partially counted lots without forcing the item total", async ({
    db,
  }) => {
    const partialMaterialCreate = await createItem({
      name: `Stocktake Partial Lot ${ts}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `STK-PARTIAL-${ts}`,
      category: materialCategory,
      description: "Partial lot count material",
      defaultPurchasePrice: "2.50",
      defaultSellingPrice: null,
      stock: "2",
      safetyStock: "0",
      bom: [],
    });
    expect(partialMaterialCreate.status).toBe(201);
    const partialMaterialId = partialMaterialCreate.body.id;

    const addSecondLot = await updateItem(partialMaterialId, {
      name: `Stocktake Partial Lot ${ts}`,
      sku: `STK-PARTIAL-${ts}`,
      category: materialCategory,
      description: "Partial lot count material",
      defaultPurchasePrice: "2.50",
      defaultSellingPrice: null,
      manufacturingMode: "discrete",
      expectedBatchYield: null,
      safetyStock: "0",
      stock: "5",
      bom: [],
    });
    expect(addSecondLot.status).toBe(200);

    const stocktakeResponse = await testFetch("/api/stocktakes", {
      method: "POST",
      body: JSON.stringify({
        name: `Partial Lot Stocktake ${ts}`,
        scope: "material",
        notes: null,
        itemIds: [partialMaterialId],
      }),
    });
    expect(stocktakeResponse.status).toBe(201);
    const partialStocktake = await stocktakeResponse.json();

    const [partialLine] = await db
      .select()
      .from(stocktakeItems)
      .where(eq(stocktakeItems.stocktakeId, partialStocktake.id));
    const partialLotLines = await db
      .select()
      .from(stocktakeLotItems)
      .where(eq(stocktakeLotItems.stocktakeItemId, partialLine.id))
      .orderBy(asc(stocktakeLotItems.sortOrder));

    const savePartial = await testFetch(`/api/stocktakes/${partialStocktake.id}`, {
      method: "PUT",
      body: JSON.stringify({
        lines:
          partialLotLines.length >= 2
            ? []
            : [
                {
                  lineId: partialLine.id,
                  countedQty: "1",
                },
              ],
        lotLines:
          partialLotLines.length >= 2
            ? [
                {
                  lotLineId: partialLotLines[0].id,
                  countedQty: "1",
                },
              ]
            : [],
      }),
    });
    expect(savePartial.status).toBe(200);

    const completePartial = await testFetch(
      `/api/stocktakes/${partialStocktake.id}/complete`,
      {
        method: "POST",
        body: JSON.stringify({ confirmStale: false }),
      }
    );
    expect(completePartial.status).toBe(200);

    const [completedLine] = await db
      .select()
      .from(stocktakeItems)
      .where(eq(stocktakeItems.id, partialLine.id));
    const completedLotLines = await db
      .select()
      .from(stocktakeLotItems)
      .where(eq(stocktakeLotItems.stocktakeItemId, partialLine.id))
      .orderBy(asc(stocktakeLotItems.sortOrder));
    const [partialStock] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${lots.quantity}), 0)`,
      })
      .from(lots)
      .where(eq(lots.itemId, partialMaterialId));

    expect(completedLine.countedQty).toBe("1.0000");
    if (partialLotLines.length >= 2) {
      expect(completedLine.appliedDeltaQty).toBe("-1.0000");
      expect(completedLotLines[0].appliedDeltaQty).toBe("-1.0000");
      expect(completedLotLines[1].countedQty).toBeNull();
      expect(completedLotLines[1].appliedDeltaQty).toBeNull();
      expect(parseFloat(partialStock.total)).toBe(4);
    } else {
      expect(completedLine.appliedDeltaQty).toBe("-4.0000");
      expect(completedLotLines).toHaveLength(0);
      expect(parseFloat(partialStock.total)).toBe(1);
    }
  });

  test("warns on stale completion, applies deltas, and preserves snapshots", async ({
    page,
    db,
  }) => {
    const materialUpdate = await updateItem(materialId, {
      name: materialName,
      sku: `STK-MAT-${ts}`,
      category: materialCategory,
      description: "Primary stocktake material",
      defaultPurchasePrice: "2.50",
      defaultSellingPrice: null,
      manufacturingMode: "discrete",
      expectedBatchYield: null,
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
          countedQty: "4",
        }),
      ])
    );

    await page.goto(`/inventory/stocktakes/${stocktakeId}`);
    await expect(page.getByRole("button", { name: "Complete" })).toBeEnabled();
    await page.getByRole("button", { name: "Complete" }).click();
    const staleDialog = page.getByRole("dialog", { name: "Complete with changed stock?" });
    await expect(staleDialog).toBeVisible();
    await expect(staleDialog).toContainText(materialName);
    await expect(staleDialog).toContainText("5");
    await expect(staleDialog).toContainText("7");
    await expect(staleDialog).toContainText("4");
    await staleDialog.getByRole("button", { name: "Complete With Live Stock" }).click();

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
      }, { timeout: 30_000 })
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

    const stocktakeEvents = await db
      .select({
        quantity: inventoryEvents.quantity,
        eventType: inventoryEvents.eventType,
        referenceType: inventoryEvents.referenceType,
        referenceId: inventoryEvents.referenceId,
      })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, materialId),
          eq(inventoryEvents.eventType, "stocktake_loss"),
          sql`${inventoryEvents.metadata}->>'stocktakeId' = ${stocktakeId}`
        )
      );

    expect(stocktakeEvents.length).toBeGreaterThanOrEqual(1);
    expect(stocktakeEvents.every((event) => event.referenceType === "stocktake_line"))
      .toBe(true);
    expect(
      stocktakeEvents.reduce(
        (sum, event) => sum + parseFloat(event.quantity),
        0
      )
    ).toBe(3);

    const productRename = await updateItem(productId, {
      name: renamedProductName,
      sku: `STK-PROD-${ts}`,
      category: productCategory,
      description: "Primary stocktake product",
      defaultPurchasePrice: null,
      defaultSellingPrice: "12.00",
      manufacturingMode: "discrete",
      expectedBatchYield: null,
      safetyStock: "0",
      stock: "0",
      bom: [],
    });

    expect(productRename.status).toBe(200);

    await page.goto(`/inventory/stocktakes/${stocktakeId}`);
    await expect(page.locator("main").getByText("Completed", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(`1 / ${lines.length}`)).toBeVisible();
    await expect(page.locator("table").first()).toContainText("-1");
    await expect(page.getByText(productName)).toBeVisible();
    await expect(page.getByText(renamedProductName)).not.toBeVisible();
  });

  test("deletes a draft stocktake without mutating inventory", async ({ page, db }) => {
    const stocktakeDeleteResponse = await testFetch("/api/stocktakes", {
      method: "DELETE",
      body: JSON.stringify({ ids: [productCategoryStocktakeId] }),
    });

    expect(stocktakeDeleteResponse.status).toBe(200);

    const [deletedStocktake] = await db
      .select()
      .from(stocktakes)
      .where(eq(stocktakes.id, productCategoryStocktakeId));

    expect(deletedStocktake.status).toBe("deleted");
    expect(deletedStocktake.cancelledAt).not.toBeNull();

    const [productStock] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${lots.quantity}), 0)`,
      })
      .from(lots)
      .where(eq(lots.itemId, productId));

    expect(parseFloat(productStock.total)).toBe(0);

    const deletedEvents = await db
      .select({ id: inventoryEvents.id })
      .from(inventoryEvents)
      .where(sql`${inventoryEvents.metadata}->>'stocktakeId' = ${productCategoryStocktakeId}`);

    expect(deletedEvents).toHaveLength(0);

    await page.goto("/inventory/stocktakes");
    await filterList(page, "Search stocktakes", `Product Category Count ${ts}`);
    await expect(
      page.getByRole("row", { name: new RegExp(`Product Category Count ${ts}`) })
    ).toHaveCount(0);
  });

  test("derives product stock-adjustment cost from the updated BOM", async ({ db }) => {
    const productAdjustment = await updateItem(productId, {
      name: renamedProductName,
      sku: `STK-PROD-${ts}`,
      category,
      description: "Primary stocktake product",
      defaultPurchasePrice: null,
      defaultSellingPrice: "12.00",
      manufacturingMode: "discrete",
      expectedBatchYield: null,
      safetyStock: "0",
      stock: "2",
      bom: [{ componentId: materialId, quantity: "2" }],
    });

    expect(productAdjustment.status).toBe(200);

    const productLots = await db
      .select({
        quantity: lots.quantity,
        costPerUnit: inventoryLotBalances.unitCost,
      })
      .from(lots)
      .innerJoin(inventoryLotBalances, eq(inventoryLotBalances.lotId, lots.id))
      .where(eq(lots.itemId, productId))
      .orderBy(asc(lots.receivedAt), asc(lots.id));

    expect(productLots).toHaveLength(1);
    expect(productLots[0].quantity).toBe("2.0000");
    expect(productLots[0].costPerUnit).toBe("5.000000");
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
        costPerUnit: inventoryLotBalances.unitCost,
      })
      .from(lots)
      .innerJoin(inventoryLotBalances, eq(inventoryLotBalances.lotId, lots.id))
      .where(eq(lots.itemId, openingStockProductId));

    expect(productLots).toHaveLength(1);
    expect(productLots[0].quantity).toBe("1.0000");
    expect(productLots[0].costPerUnit).toBe("5.000000");
  });

  test("creates material opening stock using stock-unit cost when purchase units are configured", async ({
    db,
  }) => {
    const gallonUnit = await createUnit({
      name: `Stocktake Gallon ${ts}`,
      size: "1",
      uom: "gal",
    });
    expect(gallonUnit.status).toBe(201);

    const purchaseUnit = await createUnit({
      name: `Stocktake 325 Gallon Tote ${ts}`,
      size: "325",
      uom: "gal",
    });
    expect(purchaseUnit.status).toBe(201);

    const materialCreate = await createItem({
      name: `Stocktake Converted Cost ${ts}`,
      itemType: "material",
      unitDefinitionId: gallonUnit.body.id,
      purchaseUnitDefinitionId: purchaseUnit.body.id,
      purchaseToStockFactor: "325",
      sku: `STK-CONV-${ts}`,
      category: materialCategory,
      description: "Material with purchase-unit conversion",
      defaultPurchasePrice: "250",
      defaultSellingPrice: null,
      stock: "325",
      safetyStock: "0",
      bom: [],
    });

    expect(materialCreate.status).toBe(201);
    const convertedMaterialId = materialCreate.body.id as string;

    const [lot] = await db
      .select({
        quantity: lots.quantity,
        costPerUnit: inventoryLotBalances.unitCost,
      })
      .from(lots)
      .innerJoin(inventoryLotBalances, eq(inventoryLotBalances.lotId, lots.id))
      .where(eq(lots.itemId, convertedMaterialId));

    expect(lot.quantity).toBe("325.0000");
    expect(lot.costPerUnit).toBe("0.769231");

    const [event] = await db
      .select({
        eventType: inventoryEvents.eventType,
        unitCost: inventoryEvents.unitCost,
      })
      .from(inventoryEvents)
      .where(eq(inventoryEvents.itemId, convertedMaterialId))
      .orderBy(asc(inventoryEvents.occurredAt), asc(inventoryEvents.id));

    expect(event.eventType).toBe("manual_adjustment_increase");
    expect(event.unitCost).toBe("0.769231");
  });

  test("creates product opening stock using BOM-derived converted material cost", async ({
    db,
  }) => {
    const gallonUnit = await createUnit({
      name: `Stocktake Product Gallon ${ts}`,
      size: "1",
      uom: "gal",
    });
    expect(gallonUnit.status).toBe(201);

    const purchaseUnit = await createUnit({
      name: `Stocktake Product 325 Gallon Tote ${ts}`,
      size: "325",
      uom: "gal",
    });
    expect(purchaseUnit.status).toBe(201);

    const materialCreate = await createItem({
      name: `Stocktake BOM Converted Material ${ts}`,
      itemType: "material",
      unitDefinitionId: gallonUnit.body.id,
      purchaseUnitDefinitionId: purchaseUnit.body.id,
      purchaseToStockFactor: "325",
      sku: `STK-BOM-CONV-MAT-${ts}`,
      category: materialCategory,
      description: "Converted-cost BOM material",
      defaultPurchasePrice: "250",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });

    expect(materialCreate.status).toBe(201);

    const productCreate = await createItem({
      name: `Stocktake BOM Converted Product ${ts}`,
      itemType: "product",
      unitDefinitionId: gallonUnit.body.id,
      sku: `STK-BOM-CONV-PROD-${ts}`,
      category: productCategory,
      description: "Product opening stock costed from converted BOM ingredient",
      defaultPurchasePrice: null,
      defaultSellingPrice: "18.00",
      stock: "1",
      safetyStock: "0",
      bom: [{ componentId: materialCreate.body.id, quantity: "10" }],
    });

    expect(productCreate.status).toBe(201);
    const convertedProductId = productCreate.body.id as string;

    const [lot] = await db
      .select({
        quantity: lots.quantity,
        costPerUnit: inventoryLotBalances.unitCost,
      })
      .from(lots)
      .innerJoin(inventoryLotBalances, eq(inventoryLotBalances.lotId, lots.id))
      .where(eq(lots.itemId, convertedProductId));

    expect(lot.quantity).toBe("1.0000");
    expect(lot.costPerUnit).toBe("7.692310");
  });
});
