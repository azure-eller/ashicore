import fs from "node:fs";
import { eq } from "drizzle-orm";
import { test, expect } from "./fixtures";
import {
  bomComponents,
  items,
  lots,
} from "../../lib/db/schema";

const env = JSON.parse(fs.readFileSync("test/.test-env.json", "utf-8"));
const SESSION_COOKIE = env.TEST_SESSION_COOKIE;

function parseCookie(raw: string) {
  const [name, ...rest] = raw.split("=");
  return { name, value: rest.join("=") };
}

test.beforeEach(async ({ context }) => {
  const { name, value } = parseCookie(SESSION_COOKIE);
  await context.addCookies([
    { name, value, domain: "localhost", path: "/" },
  ]);
});

test.describe("Inventory creation flow", () => {
  test.describe.configure({ mode: "serial" });

  const ts = Date.now();

  let fullMaterialId: string;
  let fullMaterialName: string;
  let minimalMaterialId: string;
  let minimalMaterialName: string;
  let lowStockMaterialId: string;
  let lowStockMaterialName: string;
  let simpleProductId: string;
  let simpleProductName: string;
  let sellableProductName: string;

  test("creates a material with all fields", async ({ page, db }) => {
    fullMaterialName = `Sand ${ts}`;
    const sku = `MAT-SAND-${ts}`;

    await page.goto("/inventory/materials/new");
    await expect(page.getByText("Add Material")).toBeVisible();

    await page.getByLabel("Name").fill(fullMaterialName);
    await page.getByLabel("Description").fill("Fine grain river sand");
    await page.getByLabel("SKU").fill(sku);

    const categoryInput = page.getByPlaceholder("Search or create category...");
    await categoryInput.click();
    await categoryInput.fill(`Aggregates ${ts}`);
    await page.getByRole("option", { name: new RegExp(`Create "Aggregates ${ts}"`) }).click();
    await expect(
      page.getByRole("option", { name: new RegExp(`Create "Aggregates ${ts}"`) })
    ).not.toBeVisible();

    await page.locator("#unitDefinitionId").click();
    await page.getByRole("option", { name: "+ Create new unit" }).click();

    await expect(page.getByText("Define a new unit of measure")).toBeVisible();
    await page.locator("#unit-name").fill(`Bag ${ts}`);
    await page.locator("#unit-size").fill("25");
    await page.locator("#unit-uom").click();
    await page.getByRole("option", { name: /kilogram/i }).click();

    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText("Define a new unit of measure")).not.toBeVisible();
    await expect(page.locator("#unitDefinitionId")).toContainText(`Bag ${ts}`);

    await page.getByLabel("Purchase Price").fill("3.50");
    await page.getByLabel("Selling Price").fill("6.00");
    await page.getByLabel("Stock", { exact: true }).fill("200");
    await page.getByLabel("Safety Stock").fill("25");

    await page.getByRole("button", { name: "Create Material" }).click();
    await page.waitForURL("**/inventory/materials");

    const rows = await db.select().from(items).where(eq(items.name, fullMaterialName));
    expect(rows).toHaveLength(1);

    const material = rows[0];
    fullMaterialId = material.id;

    expect(material.itemType).toBe("material");
    expect(material.description).toBe("Fine grain river sand");
    expect(material.sku).toBe(sku);
    expect(material.category).toBe(`Aggregates ${ts}`);
    expect(material.defaultPurchasePrice).toBe("3.5000");
    expect(material.defaultSellingPrice).toBe("6.00");
    expect(material.safetyStock).toBe("25.0000");

    const lotRows = await db.select().from(lots).where(eq(lots.itemId, material.id));
    expect(lotRows).toHaveLength(1);
    expect(lotRows[0].quantity).toBe("200.0000");
  });

  test("creates a material with only required fields", async ({ page, db }) => {
    minimalMaterialName = `Gravel ${ts}`;

    await page.goto("/inventory/materials/new");
    await expect(page.getByText("Add Material")).toBeVisible();

    await page.getByLabel("Name").fill(minimalMaterialName);
    await page.locator("#unitDefinitionId").click();
    await page.getByRole("option").first().click();

    await page.getByRole("button", { name: "Create Material" }).click();
    await page.waitForURL("**/inventory/materials");

    const rows = await db.select().from(items).where(eq(items.name, minimalMaterialName));
    expect(rows).toHaveLength(1);

    const material = rows[0];
    minimalMaterialId = material.id;

    expect(material.itemType).toBe("material");
    expect(material.description).toBeNull();
    expect(material.sku).toBeNull();
    expect(material.category).toBeNull();
    expect(material.defaultPurchasePrice).toBeNull();
    expect(material.defaultSellingPrice).toBeNull();

    const lotRows = await db.select().from(lots).where(eq(lots.itemId, material.id));
    expect(lotRows).toHaveLength(0);
  });

  test("shows calculated stock tooltips and preserves calculated stock sorting", async ({
    page,
    db,
  }) => {
    lowStockMaterialName = `Silt ${ts}`;

    await page.goto("/inventory/materials/new");
    await expect(page.getByText("Add Material")).toBeVisible();

    await page.getByLabel("Name").fill(lowStockMaterialName);
    await page.locator("#unitDefinitionId").click();
    await page.getByRole("option").first().click();
    await page.getByLabel("Safety Stock").fill("5");

    await page.getByRole("button", { name: "Create Material" }).click();
    await page.waitForURL("**/inventory/materials");

    const rows = await db.select().from(items).where(eq(items.name, lowStockMaterialName));
    expect(rows).toHaveLength(1);

    const material = rows[0];
    lowStockMaterialId = material.id;

    expect(material.safetyStock).toBe("5.0000");

    await page.getByLabel("Search items").fill(String(ts));

    const calculatedStockHeader = page.getByRole("button", {
      name: /^Sort by Calculated Stock$/,
    });
    await calculatedStockHeader.hover();
    await expect(
      page.getByText("Stock - committed + expected - safety stock.")
    ).toBeVisible();

    await calculatedStockHeader.click();
    const firstRow = page.locator("tbody tr").first();
    await expect(firstRow.getByRole("link")).toContainText(lowStockMaterialName);

    const lowStockLink = page.getByRole("link", {
      name: new RegExp(lowStockMaterialName),
    });
    await lowStockLink.hover();
    await expect(
      page.getByText(
        "Calculated stock is below zero, so this item is below its safety stock threshold."
      )
    ).toBeVisible();

    await lowStockLink.click();
    await page.waitForURL(`**/inventory/materials/${lowStockMaterialId}`);
    await expect(page.getByRole("heading", { name: lowStockMaterialName })).toBeVisible();

    await page.getByText("Calculated Stock", { exact: true }).hover();
    await expect(
      page.getByText("Stock - committed + expected - safety stock.")
    ).toBeVisible();

    await page.locator("dd").filter({ hasText: "-5" }).first().hover();
    await expect(
      page.getByText(
        "Calculated stock is below zero, so this item is below its safety stock threshold."
      )
    ).toBeVisible();
  });

  test("creates a product with all fields except BOM", async ({ page, db }) => {
    simpleProductName = `Base Mix ${ts}`;

    await page.goto("/inventory/products/new");
    await expect(page.getByText("Add Product")).toBeVisible();

    await page.getByLabel("Name").fill(simpleProductName);
    await page.getByLabel("Description").fill("Simple base product");
    await page.getByLabel("SKU").fill(`PROD-BASE-${ts}`);

    const categoryInput = page.getByPlaceholder("Search or create category...");
    await categoryInput.click();
    await categoryInput.fill(`Mixes ${ts}`);
    await page.getByRole("option", { name: new RegExp(`Create "Mixes ${ts}"`) }).click();
    await expect(
      page.getByRole("option", { name: new RegExp(`Create "Mixes ${ts}"`) })
    ).not.toBeVisible();

    await page.locator("#unitDefinitionId").click();
    await page.getByRole("option", { name: "+ Create new unit" }).click();

    await expect(page.getByText("Define a new unit of measure")).toBeVisible();
    await page.locator("#unit-name").fill(`Bucket ${ts}`);
    await page.locator("#unit-size").fill("10");
    await page.locator("#unit-uom").click();
    await page.getByRole("option", { name: "liter (l)" }).click();

    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText("Define a new unit of measure")).not.toBeVisible();
    await expect(page.locator("#unitDefinitionId")).toContainText(`Bucket ${ts}`);

    await page.getByLabel("Selling Price").fill("12.00");
    await page.getByLabel("Stock", { exact: true }).fill("50");
    await page.getByLabel("Safety Stock").fill("10");

    await page.getByRole("button", { name: "Create Product" }).click();
    await page.waitForURL("**/inventory/products");

    const rows = await db.select().from(items).where(eq(items.name, simpleProductName));
    expect(rows).toHaveLength(1);

    const product = rows[0];
    simpleProductId = product.id;

    expect(product.itemType).toBe("product");
    expect(product.category).toBe(`Mixes ${ts}`);
    expect(product.defaultSellingPrice).toBe("12.00");
    expect(product.safetyStock).toBe("10.0000");

    const bomRows = await db
      .select()
      .from(bomComponents)
      .where(eq(bomComponents.itemId, product.id));
    expect(bomRows).toHaveLength(0);

    const lotRows = await db.select().from(lots).where(eq(lots.itemId, product.id));
    expect(lotRows).toHaveLength(1);
    expect(lotRows[0].quantity).toBe("50.0000");
  });

  test("creates a product with BOM using the materials and product above", async ({ page, db }) => {
    sellableProductName = `Premium Topsoil ${ts}`;

    await page.goto("/inventory/products/new");
    await expect(page.getByText("Add Product")).toBeVisible();

    await page.getByLabel("Name").fill(sellableProductName);
    await page.getByLabel("Description").fill("Premium blend using all previous items");

    const categoryInput = page.getByPlaceholder("Search or create category...");
    await categoryInput.click();
    await categoryInput.fill(`Blends ${ts}`);
    await page.getByRole("option", { name: new RegExp(`Create "Blends ${ts}"`) }).click();
    await expect(
      page.getByRole("option", { name: new RegExp(`Create "Blends ${ts}"`) })
    ).not.toBeVisible();

    await page.locator("#unitDefinitionId").click();
    await page.getByRole("option").first().click();
    await page.getByLabel("Selling Price").fill("29.99");

    await page.getByText("+ Add Ingredient").click();
    let row = page.locator("tbody tr").last();
    await row.getByPlaceholder("Search items...").click();
    await row.getByPlaceholder("Search items...").fill(fullMaterialName);
    await page.getByRole("option", { name: fullMaterialName }).click();
    await row.locator("input[inputmode='decimal']").fill("4.5");
    await page.getByText("Recipe / Bill of Materials").click();

    await page.getByText("+ Add Ingredient").click();
    row = page.locator("tbody tr").last();
    await row.getByPlaceholder("Search items...").click();
    await row.getByPlaceholder("Search items...").fill(minimalMaterialName);
    await page.getByRole("option", { name: minimalMaterialName }).click();
    await row.locator("input[inputmode='decimal']").fill("3");
    await page.getByText("Recipe / Bill of Materials").click();

    await page.getByText("+ Add Ingredient").click();
    row = page.locator("tbody tr").last();
    await row.getByPlaceholder("Search items...").click();
    await row.getByPlaceholder("Search items...").fill(simpleProductName);
    await page.getByRole("option", { name: simpleProductName }).click();
    await row.locator("input[inputmode='decimal']").fill("2");

    await page.getByRole("button", { name: "Create Product" }).click();
    await page.waitForURL("**/inventory/products");

    const rows = await db.select().from(items).where(eq(items.name, sellableProductName));
    expect(rows).toHaveLength(1);

    const product = rows[0];
    expect(product.itemType).toBe("product");
    expect(product.category).toBe(`Blends ${ts}`);
    expect(product.defaultSellingPrice).toBe("29.99");

    const bomRows = await db
      .select()
      .from(bomComponents)
      .where(eq(bomComponents.itemId, product.id));

    expect(bomRows).toHaveLength(3);

    const bomByComponent = new Map(bomRows.map((row) => [row.componentId, row.quantity]));
    expect(bomByComponent.get(fullMaterialId)).toBe("4.5000");
    expect(bomByComponent.get(minimalMaterialId)).toBe("3.0000");
    expect(bomByComponent.get(simpleProductId)).toBe("2.0000");

    await page.goto(`/inventory/products/${product.id}`);
    await expect(page.getByRole("heading", { name: sellableProductName })).toBeVisible();
    const bomTable = page.locator("table").first();
    await expect(bomTable).toContainText(fullMaterialName);
    await expect(bomTable).toContainText(minimalMaterialName);
    await expect(bomTable).toContainText(simpleProductName);
  });
});
