import fs from "node:fs";
import { eq } from "drizzle-orm";
import { test, expect } from "./fixtures";
import { items, bomComponents, lots, stockMovements } from "../../lib/db/schema";

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

/* ================================================================== */
/*  Linear creation flow — each test builds on the previous ones      */
/* ================================================================== */

test.describe("Item creation flow", () => {
  test.describe.configure({ mode: "serial" });

  const ts = Date.now();

  // Shared state — populated by earlier tests, used by later ones
  let fullMaterialId: string;
  let fullMaterialName: string;
  let minimalMaterialId: string;
  let minimalMaterialName: string;
  let simpleProductId: string;
  let simpleProductName: string;

  /* ── 1. Material with every field ────────────────────────────── */

  test("creates a material with all fields", async ({ page, db }) => {
    fullMaterialName = `Sand ${ts}`;
    const sku = `MAT-SAND-${ts}`;

    await page.goto("/inventory/materials/new");
    await expect(page.getByText("Add Material")).toBeVisible();

    await page.getByLabel("Name").fill(fullMaterialName);
    await page.getByLabel("Description").fill("Fine grain river sand");
    await page.getByLabel("SKU").fill(sku);

    // Category — create a new one
    const catInput = page.getByPlaceholder("Search or create category...");
    await catInput.click();
    await catInput.fill(`Aggregates ${ts}`);
    await page.getByRole("option", { name: new RegExp(`Create "Aggregates ${ts}"`) }).click();

    // Wait for the category combobox to close before clicking the unit select
    await expect(page.getByRole("option", { name: new RegExp(`Create "Aggregates ${ts}"`) })).not.toBeVisible();

    // Unit — create a new one through the dialog
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

    // Pricing & stock (materials have both Purchase and Selling Price)
    await page.getByLabel("Purchase Price").fill("3.50");
    await page.getByLabel("Selling Price").fill("6.00");
    await page.getByLabel("Stock", { exact: true }).fill("200");
    await page.getByLabel("Safety Stock").fill("25");

    await page.getByRole("button", { name: "Create Material" }).click();
    await page.waitForURL("**/inventory/materials");

    // ── Database check ──
    const rows = await db.select().from(items).where(eq(items.name, fullMaterialName));
    expect(rows).toHaveLength(1);

    const mat = rows[0];
    fullMaterialId = mat.id;

    expect(mat.itemType).toBe("material");
    expect(mat.description).toBe("Fine grain river sand");
    expect(mat.sku).toBe(sku);
    expect(mat.category).toBe(`Aggregates ${ts}`);
    expect(mat.defaultPurchasePrice).toBe("3.5000");
    expect(mat.defaultSellingPrice).toBe("6.00");
    expect(mat.safetyStock).toBe("25.0000");

    // Stock should have created a lot
    const lotRows = await db.select().from(lots).where(eq(lots.itemId, mat.id));
    expect(lotRows).toHaveLength(1);
    expect(lotRows[0].quantity).toBe("200.0000");
  });

  /* ── 2. Material with only required fields ───────────────────── */

  test("creates a material with only required fields", async ({ page, db }) => {
    minimalMaterialName = `Gravel ${ts}`;

    await page.goto("/inventory/materials/new");
    await expect(page.getByText("Add Material")).toBeVisible();

    await page.getByLabel("Name").fill(minimalMaterialName);

    // Unit (required)
    await page.locator("#unitDefinitionId").click();
    await page.getByRole("option").first().click();

    await page.getByRole("button", { name: "Create Material" }).click();
    await page.waitForURL("**/inventory/materials");

    // ── Database check ──
    const rows = await db.select().from(items).where(eq(items.name, minimalMaterialName));
    expect(rows).toHaveLength(1);

    const mat = rows[0];
    minimalMaterialId = mat.id;

    expect(mat.itemType).toBe("material");
    expect(mat.description).toBeNull();
    expect(mat.sku).toBeNull();
    expect(mat.category).toBeNull();
    expect(mat.defaultPurchasePrice).toBeNull();
    expect(mat.defaultSellingPrice).toBeNull();

    // No stock entered → no lot created
    const lotRows = await db.select().from(lots).where(eq(lots.itemId, mat.id));
    expect(lotRows).toHaveLength(0);
  });

  /* ── 3. Product without BOM ──────────────────────────────────── */

  test("creates a product with all fields except BOM", async ({ page, db }) => {
    simpleProductName = `Base Mix ${ts}`;

    await page.goto("/inventory/products/new");
    await expect(page.getByText("Add Product")).toBeVisible();

    await page.getByLabel("Name").fill(simpleProductName);
    await page.getByLabel("Description").fill("Simple base product");
    await page.getByLabel("SKU").fill(`PROD-BASE-${ts}`);

    // Category
    const catInput3 = page.getByPlaceholder("Search or create category...");
    await catInput3.click();
    await catInput3.fill(`Mixes ${ts}`);
    await page.getByRole("option", { name: new RegExp(`Create "Mixes ${ts}"`) }).click();
    await expect(page.getByRole("option", { name: new RegExp(`Create "Mixes ${ts}"`) })).not.toBeVisible();

    // Unit — create a new one (different from the material's unit)
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

    // ── Database check ──
    const rows = await db.select().from(items).where(eq(items.name, simpleProductName));
    expect(rows).toHaveLength(1);

    const prod = rows[0];
    simpleProductId = prod.id;

    expect(prod.itemType).toBe("product");
    expect(prod.category).toBe(`Mixes ${ts}`);
    expect(prod.defaultSellingPrice).toBe("12.00");
    expect(prod.safetyStock).toBe("10.0000");

    // No BOM rows
    const bomRows = await db.select().from(bomComponents).where(eq(bomComponents.itemId, prod.id));
    expect(bomRows).toHaveLength(0);

    // Stock lot exists
    const lotRows = await db.select().from(lots).where(eq(lots.itemId, prod.id));
    expect(lotRows).toHaveLength(1);
    expect(lotRows[0].quantity).toBe("50.0000");
  });

  /* ── 4. Product with BOM — references all items above ────────── */

  test("creates a product with BOM using the materials and product above", async ({ page, db }) => {
    const productName = `Premium Topsoil ${ts}`;

    await page.goto("/inventory/products/new");
    await expect(page.getByText("Add Product")).toBeVisible();

    await page.getByLabel("Name").fill(productName);
    await page.getByLabel("Description").fill("Premium blend using all previous items");

    // Category
    const catInput4 = page.getByPlaceholder("Search or create category...");
    await catInput4.click();
    await catInput4.fill(`Blends ${ts}`);
    await page.getByRole("option", { name: new RegExp(`Create "Blends ${ts}"`) }).click();
    await expect(page.getByRole("option", { name: new RegExp(`Create "Blends ${ts}"`) })).not.toBeVisible();

    // Unit
    await page.locator("#unitDefinitionId").click();
    await page.getByRole("option").first().click();

    await page.getByLabel("Selling Price").fill("29.99");

    // Add BOM row 1 — full material (Sand)
    await page.getByText("+ Add Ingredient").click();
    let row = page.locator("tbody tr").last();
    await row.getByPlaceholder("Search items...").click();
    await row.getByPlaceholder("Search items...").fill(fullMaterialName);
    await page.getByRole("option", { name: fullMaterialName }).click();
    await row.locator("input[inputmode='decimal']").fill("4.5");
    // Click the heading to blur and dismiss any popover before adding the next row
    await page.getByText("Recipe / Bill of Materials").click();

    // Add BOM row 2 — minimal material (Gravel)
    await page.getByText("+ Add Ingredient").click();
    row = page.locator("tbody tr").last();
    await row.getByPlaceholder("Search items...").click();
    await row.getByPlaceholder("Search items...").fill(minimalMaterialName);
    await page.getByRole("option", { name: minimalMaterialName }).click();
    await row.locator("input[inputmode='decimal']").fill("3");
    await page.getByText("Recipe / Bill of Materials").click();

    // Add BOM row 3 — product (Base Mix)
    await page.getByText("+ Add Ingredient").click();
    row = page.locator("tbody tr").last();
    await row.getByPlaceholder("Search items...").click();
    await row.getByPlaceholder("Search items...").fill(simpleProductName);
    await page.getByRole("option", { name: simpleProductName }).click();
    await row.locator("input[inputmode='decimal']").fill("2");

    // Submit
    await page.getByRole("button", { name: "Create Product" }).click();
    await page.waitForURL("**/inventory/products");

    // ── Database check ──
    const rows = await db.select().from(items).where(eq(items.name, productName));
    expect(rows).toHaveLength(1);

    const product = rows[0];
    expect(product.itemType).toBe("product");
    expect(product.category).toBe(`Blends ${ts}`);
    expect(product.defaultSellingPrice).toBe("29.99");

    // BOM — 3 ingredients
    const bomRows = await db
      .select()
      .from(bomComponents)
      .where(eq(bomComponents.itemId, product.id));

    expect(bomRows).toHaveLength(3);

    const bomByComponent = new Map(bomRows.map((r) => [r.componentId, r.quantity]));
    expect(bomByComponent.get(fullMaterialId)).toBe("4.5000");
    expect(bomByComponent.get(minimalMaterialId)).toBe("3.0000");
    expect(bomByComponent.get(simpleProductId)).toBe("2.0000");

    // Detail page shows the BOM
    await page.goto(`/inventory/products/${product.id}`);
    await expect(page.getByRole("heading", { name: productName })).toBeVisible();
    const bomTable = page.locator("table").first();
    await expect(bomTable).toContainText(fullMaterialName);
    await expect(bomTable).toContainText(minimalMaterialName);
    await expect(bomTable).toContainText(simpleProductName);
  });
});
