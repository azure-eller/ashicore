import { and, asc, eq, inArray } from "drizzle-orm";
import { test, expect, getIdFromUrl } from "../fixtures";
import { items, stocktakeItems, stocktakes } from "../../../lib/db/schema";
import { createItem, getUnitId } from "../../helpers/api";

test.describe("Stocktake write-path smoke", () => {
  test.describe.configure({ mode: "serial" });

  const ts = Date.now();
  const unitId = getUnitId();
  const category = `Fast Stocktake ${ts}`;
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
      category,
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
      category,
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
      .where(and(eq(items.category, category), inArray(items.id, [materialId, productId])));
    expect(createdItems).toHaveLength(2);

    await page.goto("/inventory/stocktakes/new");
    await expect(page.getByText("New Stocktake")).toBeVisible();

    await page.locator("#name").fill(`Fast Count ${ts}`);
    await page.locator("#notes").fill("Fast stocktake smoke test");
    const [createStocktakeResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/api/stocktakes")
      ),
      page.getByRole("button", { name: "Create Stocktake" }).click(),
    ]);
    expect(createStocktakeResponse.status()).toBe(201);

    await page.waitForURL(/\/inventory\/stocktakes\/[0-9a-f-]+$/);
    stocktakeId = getIdFromUrl(page.url());
    await expect(page.getByRole("button", { name: "Save Counts" })).toBeVisible();
    await expect(page.getByText("Back to Stocktakes")).toBeVisible();

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
    expect(lines.map((line) => line.itemId)).toEqual(
      expect.arrayContaining([materialId, productId])
    );

    const materialRow = page.locator("tbody tr").filter({ hasText: materialName });
    await materialRow.getByPlaceholder("Leave blank").fill("4");

    const saveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        response.url().endsWith(`/api/stocktakes/${stocktakeId}`)
    );
    await page.getByRole("button", { name: "Save Counts" }).click();
    expect((await saveResponse).status()).toBe(200);

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
  });
});
