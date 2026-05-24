import { and, asc, eq, inArray } from "drizzle-orm";
import { test, expect, getIdFromUrl } from "../fixtures";
import { items, stocktakeItems, stocktakeLotItems, stocktakes } from "../../../lib/db/schema";
import { createItem, getUnitId } from "../../helpers/api";
import { buildStocktakeCategoryScope } from "../../../lib/schemas/stocktakes";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

test.describe("Stocktake write-path smoke", () => {
  test.describe.configure({ mode: "serial" });

  const ts = Date.now();
  const unitId = getUnitId();
  const materialCategory = `Fast Stocktake Material ${ts}`;
  const productCategory = `Fast Stocktake Product ${ts}`;
  const materialName = `Fast Stocktake Bark ${ts}`;
  const productName = `Fast Stocktake Mix ${ts}`;
  let materialId = "";
  let productId = "";
  let stocktakeId = "";

  test("creates a stocktake and saves counts through the browser", async ({ page, db }) => {
    const materialCreate = await createItem({
      name: materialName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-STK-MAT-${ts}`,
      category: materialCategory,
      description: "Fast stocktake material",
      defaultPurchasePrice: "2.50",
      defaultSellingPrice: null,
      stock: "5",
      safetyStock: "0",
      bom: [],
    });
    const productCreate = await createItem({
      name: productName,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `FAST-STK-PROD-${ts}`,
      category: productCategory,
      description: "Fast stocktake product",
      defaultPurchasePrice: null,
      defaultSellingPrice: "12.00",
      stock: "0",
      safetyStock: "0",
      bom: [],
    });

    expect(materialCreate.status).toBe(201);
    expect(productCreate.status).toBe(201);
    materialId = materialCreate.body.id;
    productId = productCreate.body.id;

    const createdItems = await db
      .select({ id: items.id })
      .from(items)
      .where(
        and(
          inArray(items.category, [materialCategory, productCategory]),
          inArray(items.id, [materialId, productId])
        )
      );
    expect(createdItems).toHaveLength(2);

    await page.goto("/inventory/stocktakes/new");
    await page.waitForURL(/\/inventory\/stocktakes\/[0-9a-f-]+$/);
    stocktakeId = getIdFromUrl(page.url());
    await expect(page.getByRole("heading", { name: `all_items_${todayIsoDate()}` })).toBeVisible();

    const expectedStocktakeName = `materials_${materialCategory
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")}_${todayIsoDate()}`;

    const [scopeResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "PUT" &&
          response.url().endsWith(`/api/stocktakes/${stocktakeId}`)
      ),
      page.getByRole("combobox").click().then(async () => {
        await page.getByRole("option", { name: materialCategory, exact: true }).click();
      }),
    ]);
    expect(scopeResponse.status()).toBe(200);
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(expectedStocktakeName);

    const notesField = page.getByLabel("Notes");
    await notesField.fill("Fast stocktake smoke test");
    const [notesResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "PUT" &&
          response.url().endsWith(`/api/stocktakes/${stocktakeId}`)
      ),
      notesField.evaluate((node) => (node as HTMLTextAreaElement).blur()),
    ]);
    expect(notesResponse.status()).toBe(200);
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 15_000 });

    const [stocktake] = await db
      .select()
      .from(stocktakes)
      .where(eq(stocktakes.id, stocktakeId));
    expect(stocktake.scope).toBe(
      buildStocktakeCategoryScope("material", materialCategory)
    );
    expect(stocktake.name).toBe(expectedStocktakeName);
    expect(stocktake.notes).toBe("Fast stocktake smoke test");
    expect(stocktake.status).toBe("draft");

    const lines = await db
      .select()
      .from(stocktakeItems)
      .where(eq(stocktakeItems.stocktakeId, stocktakeId))
      .orderBy(asc(stocktakeItems.sortOrder));
    expect(lines.map((line) => line.itemId)).toEqual([materialId]);

    const saveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        response.url().endsWith(`/api/stocktakes/${stocktakeId}`)
    );
    const lotCountCell = page
      .locator(".ag-center-cols-container .ag-row")
      .filter({ hasText: "LOT-" })
      .first()
      .locator('[col-id="countedQty"]');
    await lotCountCell.dblclick();
    await page.keyboard.type("4");
    await page.keyboard.press("Enter");
    expect((await saveResponse).status()).toBe(200);
    await expect(page.getByText("Saved")).toBeVisible();

    const [savedLine] = await db
      .select()
      .from(stocktakeItems)
      .where(
        and(
          eq(stocktakeItems.stocktakeId, stocktakeId),
          eq(stocktakeItems.itemId, materialId)
        )
      );
    expect(savedLine.countedQty).toBe("4.0000");

    const [savedLotLine] = await db
      .select()
      .from(stocktakeLotItems)
      .where(eq(stocktakeLotItems.stocktakeItemId, savedLine.id));
    expect(savedLotLine.countedQty).toBe("4.0000");
  });
});
