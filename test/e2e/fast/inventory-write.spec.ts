import { eq } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  bomRevisionComponents,
  bomRevisions,
  items,
  lots,
} from "../../../lib/db/schema";

test.describe("Inventory write-path smoke", () => {
  test.describe.configure({ mode: "serial" });

  const ts = Date.now();
  let materialId = "";
  let materialName = "";
  let productId = "";
  let productName = "";

  test("creates and edits a material through the browser form", async ({ page, db }) => {
    materialName = `Fast Inventory Sand ${ts}`;
    const sku = `FAST-MAT-${ts}`;

    await page.goto("/inventory/materials/new");
    await expect(page.getByText("Add Material")).toBeVisible();

    await page.getByLabel("Name").fill(materialName);
    await page.getByLabel("Description").fill("Fast smoke material");
    await page.getByLabel("SKU").fill(sku);

    const categoryInput = page.getByPlaceholder("Search or create category...");
    await categoryInput.click();
    await categoryInput.fill(`Fast Inventory ${ts}`);
    await page.getByRole("option", { name: new RegExp(`Fast Inventory ${ts}`) }).first().click();

    await page.locator("#unitDefinitionId").click();
    await page.getByRole("option", { name: "+ Create new unit" }).click();
    await page.locator("#unit-name").fill(`Bag ${ts}`);
    await page.locator("#unit-size").fill("25");
    await page.locator("#unit-uom").click();
    await page.getByRole("option", { name: /kilogram/i }).click();

    const [unitResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/api/units")
      ),
      page.getByRole("button", { name: "Create", exact: true }).click(),
    ]);
    expect(unitResponse.status()).toBe(201);

    await page.getByLabel("Purchase Price").fill("3.50");
    await page.getByLabel("Selling Price").fill("6.00");
    await page.getByLabel("Stock", { exact: true }).fill("200");
    await page.getByLabel("Safety Stock").fill("25");

    const [createResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/api/items")
      ),
      page.getByRole("button", { name: "Create Material" }).click(),
    ]);

    const createBody = await createResponse.json();
    materialId = createBody.id;

    await page.waitForURL(`**/inventory/materials/${materialId}`);
    await expect(page.getByRole("heading", { name: materialName })).toBeVisible();

    const [material] = await db.select().from(items).where(eq(items.id, materialId));
    expect(material.itemType).toBe("material");
    expect(material.description).toBe("Fast smoke material");
    expect(material.sku).toBe(sku);
    expect(material.category).toBe(`Fast Inventory ${ts}`);
    expect(material.defaultPurchasePrice).toBe("3.5000");
    expect(material.defaultSellingPrice).toBe("6.00");
    expect(material.safetyStock).toBe("25.0000");

    const materialLots = await db.select().from(lots).where(eq(lots.itemId, materialId));
    expect(materialLots).toHaveLength(1);
    expect(materialLots[0].quantity).toBe("200.0000");

    await page.getByRole("link", { name: "Edit" }).click();
    await page.waitForURL(`**/inventory/materials/${materialId}/edit`);
    await expect(page.getByRole("heading", { name: "Edit Material" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "Save Changes" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByLabel("Description")).toBeVisible({ timeout: 15_000 });

    await page.getByLabel("Description").fill("Fast smoke material updated");
    await page.getByLabel("Safety Stock").fill("30");
    const updateResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        response.url().endsWith(`/api/items/${materialId}`)
    );
    await page.getByRole("button", { name: "Save Changes" }).click();
    expect((await updateResponsePromise).status()).toBe(200);

    await page.waitForURL(`**/inventory/materials/${materialId}`);
    await expect(page.getByRole("heading", { name: materialName })).toBeVisible();

    const [updatedMaterial] = await db.select().from(items).where(eq(items.id, materialId));
    expect(updatedMaterial.description).toBe("Fast smoke material updated");
    expect(updatedMaterial.safetyStock).toBe("30.0000");
  });

  test("creates a BOM-backed product through the browser form", async ({ page, db }) => {
    productName = `Fast Blend ${ts}`;

    await page.goto("/inventory/products/new");
    await expect(page.getByText("Add Product")).toBeVisible();

    await page.getByLabel("Name").fill(productName);
    await page.getByLabel("Description").fill("Fast smoke product");

    const categoryInput = page.getByPlaceholder("Search or create category...");
    await categoryInput.click();
    await categoryInput.fill(`Fast Products ${ts}`);
    await page.getByRole("option", { name: new RegExp(`Fast Products ${ts}`) }).first().click();

    await page.locator("#unitDefinitionId").click();
    await page.getByRole("option").first().click();
    await page.getByLabel("Selling Price").fill("19.99");
    await page.getByLabel("Safety Stock").fill("5");

    await page.getByText("+ Add Ingredient").click();
    const componentInput = page.getByPlaceholder("Search items...");
    await expect(componentInput).toBeVisible();
    await componentInput.click();
    await componentInput.fill(materialName);
    await page.getByRole("option", { name: materialName }).click();
    await page.locator("input[inputmode='decimal']").last().fill("1.25");

    const [createResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/api/items")
      ),
      page.getByRole("button", { name: "Create Product" }).click(),
    ]);

    const createBody = await createResponse.json();
    productId = createBody.id;

    await page.waitForURL(`**/inventory/products/${productId}`);
    await expect(page.getByRole("heading", { name: productName })).toBeVisible();

    const [product] = await db.select().from(items).where(eq(items.id, productId));
    expect(product.itemType).toBe("product");
    expect(product.description).toBe("Fast smoke product");
    expect(product.category).toBe(`Fast Products ${ts}`);
    expect(product.defaultSellingPrice).toBe("19.99");
    expect(product.safetyStock).toBe("5.0000");

    const [currentRevision] = await db
      .select()
      .from(bomRevisions)
      .where(eq(bomRevisions.productId, productId));
    expect(currentRevision.revisionNumber).toBe(1);
    expect(currentRevision.isCurrent).toBe(true);

    const productBom = await db
      .select()
      .from(bomRevisionComponents)
      .where(eq(bomRevisionComponents.bomRevisionId, currentRevision.id));
    expect(productBom).toHaveLength(1);
    expect(productBom[0].componentId).toBe(materialId);
    expect(productBom[0].quantity).toBe("1.2500");
  });

  test("editing BOM fields creates a new BOM revision", async ({ page, db }) => {
    await page.goto(`/inventory/products/${productId}/edit`);
    await expect(page.getByRole("heading", { name: "Edit Product" })).toBeVisible();

    const bomRow = page.getByTestId("bom-row").first();
    await bomRow.locator("input[inputmode='decimal']").fill("1.5");
    await page.getByLabel("Revision Note").fill("Increase sand ratio");

    const updateResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        response.url().endsWith(`/api/items/${productId}`)
    );
    await page.getByRole("button", { name: "Save Changes" }).click();
    expect((await updateResponsePromise).status()).toBe(200);

    await page.waitForURL(`**/inventory/products/${productId}`);
    await expect(page.getByText("Rev 2")).toBeVisible();
    await expect(page.getByText("Increase sand ratio")).toBeVisible();

    const revisions = await db
      .select()
      .from(bomRevisions)
      .where(eq(bomRevisions.productId, productId));
    expect(revisions).toHaveLength(2);

    const currentRevision = revisions.find((revision) => revision.isCurrent);
    expect(currentRevision?.revisionNumber).toBe(2);
    expect(currentRevision?.note).toBe("Increase sand ratio");

    const currentBom = await db
      .select()
      .from(bomRevisionComponents)
      .where(eq(bomRevisionComponents.bomRevisionId, currentRevision!.id));
    expect(currentBom).toHaveLength(1);
    expect(currentBom[0].quantity).toBe("1.5000");
  });
});
