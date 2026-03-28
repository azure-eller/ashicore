import fs from "node:fs";
import { eq } from "drizzle-orm";
import { test, expect } from "./fixtures";
import { createItem } from "../helpers/api";
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

/** Append a timestamp to a base name for collision-free test data. */
function withTs(baseName: string, ts: number) {
  return `${baseName} ${ts}`;
}

test.beforeEach(async ({ context }) => {
  const { name, value } = parseCookie(SESSION_COOKIE);
  await context.addCookies([
    { name, value, domain: "localhost", path: "/" },
  ]);
});

test.describe("Chapter 1 — Inventory: Paonia Soil Co.", () => {
  test.describe.configure({ mode: "serial" });

  // ── Shared timestamp & env persistence ──────────────────────────
  const ts = Date.now();
  env.TEST_TIMESTAMP = ts;
  fs.writeFileSync("test/.test-env.json", JSON.stringify(env, null, 2));

  // ── Describe-level variables for cross-test data ────────────────

  // Materials — created via UI
  let coconutCoirId: string;
  let wormCastingsId: string;

  // Materials — created via API (bases)
  let perliteId: string;
  let riceHullsId: string;

  // Materials — created via API (amendments)
  let kelpMealId: string;
  let fishBoneMealId: string;
  let featherMealId: string;
  let oysterShellFlourId: string;
  let gypsumId: string;
  let dolomiteLimeId: string;
  let greensandId: string;
  let azomiteId: string;

  // Minimal material (not Paonia)
  let minimalMaterialId: string;

  // Products
  let nutePackId: string;
  let theBombId: string;
  let proBaseCocoId: string;
  let simpleProductId: string;

  // Unit IDs (created inline via UI, resolved after first material create)
  let bagUnitId: string;
  let poundUnitId: string;

  /* ══════════════════════════════════════════════════════════════════
     1. Creates Coconut Coir material with ALL fields
     ══════════════════════════════════════════════════════════════════ */

  test("creates Coconut Coir with all fields via UI", async ({ page, db }) => {
    const name = withTs("Coconut Coir", ts);
    const sku = `MAT-COCO-${ts}`;
    const categoryName = withTs("Bases", ts);
    const unitName = withTs("Bag", ts);

    await page.goto("/inventory/materials/new");
    await expect(page.getByText("Add Material")).toBeVisible();

    // ── Basics ──
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Description").fill("Premium coco coir, triple-washed");
    await page.getByLabel("SKU").fill(sku);

    // Inline category creation
    const categoryInput = page.getByPlaceholder("Search or create category...");
    await categoryInput.click();
    await categoryInput.fill(categoryName);
    await page.getByRole("option", { name: new RegExp(categoryName) }).first().click();
    await expect(page.getByRole("listbox")).not.toBeVisible();

    // Inline unit creation
    await page.locator("#unitDefinitionId").click();
    await page.getByRole("option", { name: "+ Create new unit" }).click();

    await expect(page.getByText("Define a new unit of measure")).toBeVisible();
    await page.locator("#unit-name").fill(unitName);
    await page.locator("#unit-size").fill("1");
    await page.locator("#unit-uom").click();
    await page.getByRole("option", { name: /kilogram/i }).click();

    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText("Define a new unit of measure")).not.toBeVisible();
    await expect(page.locator("#unitDefinitionId")).toContainText(unitName);

    // ── Pricing & Stock ──
    await page.getByLabel("Purchase Price").fill("8.50");
    await page.getByLabel("Selling Price").fill("12.00");
    await page.getByLabel("Stock", { exact: true }).fill("0");
    await page.getByLabel("Safety Stock").fill("20");

    await page.getByRole("button", { name: "Create Material" }).click();
    await page.waitForURL(/\/inventory\/materials\/[0-9a-f-]+$/);

    // ── UI verification: detail page ──
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByText("Premium coco coir, triple-washed")).toBeVisible();
    await expect(page.getByText(sku)).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Invalid");

    // ── DB verification ──
    const rows = await db.select().from(items).where(eq(items.name, name));
    expect(rows).toHaveLength(1);

    const material = rows[0];
    coconutCoirId = material.id;

    expect(material.itemType).toBe("material");
    expect(material.description).toBe("Premium coco coir, triple-washed");
    expect(material.sku).toBe(sku);
    expect(material.category).toBe(categoryName);
    expect(material.defaultPurchasePrice).toBe("8.5000");
    expect(material.defaultSellingPrice).toBe("12.00");
    expect(material.safetyStock).toBe("20.0000");

    // Stock=0 means no lot created
    const lotRows = await db.select().from(lots).where(eq(lots.itemId, material.id));
    expect(lotRows).toHaveLength(0);

    // Capture the bag unit ID for API-created materials
    bagUnitId = material.unitDefinitionId;
  });

  /* ══════════════════════════════════════════════════════════════════
     2. Creates remaining base materials (Perlite, Rice Hulls) via API
     ══════════════════════════════════════════════════════════════════ */

  test("creates Perlite and Rice Hulls via API", async () => {
    const baseMaterials = [
      { baseName: "Perlite", sku: `MAT-PERL-${ts}`, price: "6.00" },
      { baseName: "Rice Hulls", sku: `MAT-RICE-${ts}`, price: "4.50" },
    ];

    const ids: string[] = [];

    for (const mat of baseMaterials) {
      const { status, body } = await createItem({
        name: withTs(mat.baseName, ts),
        itemType: "material",
        unitDefinitionId: bagUnitId,
        sku: mat.sku,
        category: withTs("Bases", ts),
        description: null,
        defaultPurchasePrice: mat.price,
        defaultSellingPrice: null,
        stock: "0",
        safetyStock: "0",
        bom: [],
      });
      expect(status).toBe(201);
      expect(body.id).toBeTruthy();
      ids.push(body.id);
    }

    [perliteId, riceHullsId] = ids;
  });

  /* ══════════════════════════════════════════════════════════════════
     3. Creates Worm Castings with stock=10, verifies lot created
     ══════════════════════════════════════════════════════════════════ */

  test("creates Worm Castings with stock=10 and verifies lot", async ({ page, db }) => {
    const name = withTs("Worm Castings", ts);
    const categoryName = withTs("Amendments", ts);
    const unitName = withTs("Pound", ts);

    await page.goto("/inventory/materials/new");
    await expect(page.getByText("Add Material")).toBeVisible();

    await page.getByLabel("Name").fill(name);

    // Inline category creation — "Amendments"
    const categoryInput = page.getByPlaceholder("Search or create category...");
    await categoryInput.click();
    await categoryInput.fill(categoryName);
    await page.getByRole("option", { name: new RegExp(categoryName) }).first().click();
    await expect(page.getByRole("listbox")).not.toBeVisible();

    // Inline unit creation — "Pound"
    await page.locator("#unitDefinitionId").click();
    await page.getByRole("option", { name: "+ Create new unit" }).click();

    await expect(page.getByText("Define a new unit of measure")).toBeVisible();
    await page.locator("#unit-name").fill(unitName);
    await page.locator("#unit-size").fill("1");
    await page.locator("#unit-uom").click();
    await page.getByRole("option", { name: /pound/i }).click();

    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText("Define a new unit of measure")).not.toBeVisible();
    await expect(page.locator("#unitDefinitionId")).toContainText(unitName);

    await page.getByLabel("Purchase Price").fill("5.00");
    await page.getByLabel("Stock", { exact: true }).fill("10");
    await page.getByLabel("Safety Stock").fill("5");

    await page.getByRole("button", { name: "Create Material" }).click();
    await page.waitForURL(/\/inventory\/materials\/[0-9a-f-]+$/);

    // ── UI verification ──
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Invalid");

    // ── DB verification ──
    const rows = await db.select().from(items).where(eq(items.name, name));
    expect(rows).toHaveLength(1);

    const material = rows[0];
    wormCastingsId = material.id;

    expect(material.itemType).toBe("material");
    expect(material.category).toBe(categoryName);
    expect(material.defaultPurchasePrice).toBe("5.0000");
    expect(material.safetyStock).toBe("5.0000");

    // Stock=10 means a lot was created
    const lotRows = await db.select().from(lots).where(eq(lots.itemId, material.id));
    expect(lotRows).toHaveLength(1);
    expect(lotRows[0].quantity).toBe("10.0000");

    // Capture the pound unit ID for API-created amendment materials
    poundUnitId = material.unitDefinitionId;
  });

  /* ══════════════════════════════════════════════════════════════════
     4. Creates remaining 8 amendment materials via API
     ══════════════════════════════════════════════════════════════════ */

  test("creates 8 amendment materials via API", async () => {
    const amendments = [
      { baseName: "Kelp Meal", sku: `MAT-KELP-${ts}`, price: "12.00" },
      { baseName: "Fish Bone Meal", sku: `MAT-FISH-${ts}`, price: "10.00" },
      { baseName: "Feather Meal", sku: `MAT-FEATH-${ts}`, price: "8.00" },
      { baseName: "Oyster Shell Flour", sku: `MAT-OYSTER-${ts}`, price: "6.50" },
      { baseName: "Gypsum", sku: `MAT-GYPS-${ts}`, price: "5.00" },
      { baseName: "Dolomite Lime", sku: `MAT-DOLO-${ts}`, price: "4.00" },
      { baseName: "Greensand", sku: `MAT-GREEN-${ts}`, price: "9.00" },
      { baseName: "Azomite", sku: `MAT-AZOM-${ts}`, price: "11.00" },
    ];

    const ids: string[] = [];

    for (const mat of amendments) {
      const { status, body } = await createItem({
        name: withTs(mat.baseName, ts),
        itemType: "material",
        unitDefinitionId: poundUnitId,
        sku: mat.sku,
        category: withTs("Amendments", ts),
        description: null,
        defaultPurchasePrice: mat.price,
        defaultSellingPrice: null,
        stock: "0",
        safetyStock: "0",
        bom: [],
      });
      expect(status).toBe(201);
      expect(body.id).toBeTruthy();
      ids.push(body.id);
    }

    [
      kelpMealId,
      fishBoneMealId,
      featherMealId,
      oysterShellFlourId,
      gypsumId,
      dolomiteLimeId,
      greensandId,
      azomiteId,
    ] = ids;
  });

  /* ══════════════════════════════════════════════════════════════════
     5. Creates a minimal material (name + unit only) — coverage
     ══════════════════════════════════════════════════════════════════ */

  test("creates a minimal material with only required fields", async ({ page, db }) => {
    const name = withTs("Misc Filler", ts);

    await page.goto("/inventory/materials/new");
    await expect(page.getByText("Add Material")).toBeVisible();

    await page.getByLabel("Name").fill(name);
    await page.locator("#unitDefinitionId").click();
    await page.getByRole("option").first().click();

    await page.getByRole("button", { name: "Create Material" }).click();
    await page.waitForURL(/\/inventory\/materials\/[0-9a-f-]+$/);

    // ── UI verification ──
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Invalid");

    // ── DB verification — all optional fields null ──
    const rows = await db.select().from(items).where(eq(items.name, name));
    expect(rows).toHaveLength(1);

    const material = rows[0];
    minimalMaterialId = material.id;

    expect(material.itemType).toBe("material");
    expect(material.description).toBeNull();
    expect(material.sku).toBeNull();
    expect(material.category).toBeNull();
    expect(material.defaultPurchasePrice).toBeNull();
    expect(material.defaultSellingPrice).toBeNull();

    // No stock = no lot
    const lotRows = await db.select().from(lots).where(eq(lots.itemId, material.id));
    expect(lotRows).toHaveLength(0);
  });

  /* ══════════════════════════════════════════════════════════════════
     6. Shows calculated stock tooltips and low-stock indicators
     ══════════════════════════════════════════════════════════════════ */

  test("shows calculated stock tooltips and low-stock indicators on list page", async ({ page }) => {
    // Coconut Coir has stock=0, safetyStock=20 => calculated = -20 => low stock
    await page.goto("/inventory/materials");
    await page.getByLabel("Search items").fill(String(ts));

    // Verify the Calculated Stock column header tooltip
    const calculatedStockHeader = page.getByRole("button", {
      name: /^Sort by Calculated Stock/,
    });
    await calculatedStockHeader.hover();
    await expect(
      page.getByText("Stock - committed + expected - safety stock.")
    ).toBeVisible();

    // Sort ascending — low-stock items first
    await page.mouse.move(0, 0);
    await calculatedStockHeader.click();
    await expect(calculatedStockHeader).toHaveAttribute(
      "aria-label",
      /sorted ascending/
    );

    // Coconut Coir should be low-stock (calc = 0 - 0 + 0 - 20 = -20)
    const coconutCoirLink = page.getByRole("link", {
      name: new RegExp(withTs("Coconut Coir", ts)),
    });

    // Hover/focus on the low-stock item to see the alert tooltip
    await page.mouse.move(0, 0);
    await coconutCoirLink.focus();
    await expect(
      page.getByText(
        "Calculated stock is below zero, so this item is below its safety stock threshold."
      )
    ).toBeVisible();

    // Navigate to detail page and verify tooltip there too
    await coconutCoirLink.click();
    await page.waitForURL(`**/inventory/materials/${coconutCoirId}`);
    await expect(
      page.getByRole("heading", { name: withTs("Coconut Coir", ts) })
    ).toBeVisible();

    await page.getByText("Calculated Stock", { exact: true }).hover();
    await expect(
      page.getByText("Stock - committed + expected - safety stock.")
    ).toBeVisible();

    await page.keyboard.press("Escape");

    // Focus the destructive calculated stock value to trigger alert tooltip
    await page.locator("dd span.text-destructive").focus();
    await expect(
      page.getByText(
        "Calculated stock is below zero, so this item is below its safety stock threshold."
      )
    ).toBeVisible();
  });

  /* ══════════════════════════════════════════════════════════════════
     7. Edits Coconut Coir — changes description + safety stock
     ══════════════════════════════════════════════════════════════════ */

  test("edits Coconut Coir — verifies pre-population and saves changes", async ({ page, db }) => {
    await page.goto(`/inventory/materials/${coconutCoirId}`);
    await expect(
      page.getByRole("heading", { name: withTs("Coconut Coir", ts) })
    ).toBeVisible();
    await page.getByRole("link", { name: "Edit" }).click();
    await expect(page.getByText("Edit Material")).toBeVisible();

    // ── Verify pre-population ──
    await expect(page.getByLabel("Name")).toHaveValue(withTs("Coconut Coir", ts));
    await expect(page.getByLabel("Description")).toHaveValue(
      "Premium coco coir, triple-washed"
    );
    await expect(page.getByLabel("SKU")).toHaveValue(`MAT-COCO-${ts}`);
    await expect(page.getByLabel("Purchase Price")).toHaveValue("8.5");
    await expect(page.getByLabel("Selling Price")).toHaveValue("12");
    await expect(page.getByLabel("Safety Stock")).toHaveValue("20");

    // ── Make changes ──
    await page.getByLabel("Description").fill("Triple-washed coco coir — low EC");
    await page.getByLabel("Safety Stock").fill("25");

    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.waitForURL(`**/inventory/materials/${coconutCoirId}`);

    // ── UI verification ──
    await expect(page.getByText("Triple-washed coco coir — low EC")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Invalid");

    // ── DB verification ──
    const [updated] = await db
      .select()
      .from(items)
      .where(eq(items.id, coconutCoirId));
    expect(updated.description).toBe("Triple-washed coco coir — low EC");
    expect(updated.safetyStock).toBe("25.0000");
    // Unchanged fields intact
    expect(updated.sku).toBe(`MAT-COCO-${ts}`);
    expect(updated.defaultPurchasePrice).toBe("8.5000");
    expect(updated.defaultSellingPrice).toBe("12.00");
  });

  /* ══════════════════════════════════════════════════════════════════
     8. Creates Bomb Nute Pack product with 8-ingredient BOM via UI
     ══════════════════════════════════════════════════════════════════ */

  test("creates Bomb Nute Pack with 8-ingredient BOM", async ({ page, db }) => {
    const name = withTs("Bomb Nute Pack", ts);

    await page.goto("/inventory/products/new");
    await expect(page.getByText("Add Product")).toBeVisible();

    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Description").fill("8-amendment dry nutrient blend");

    const categoryInput = page.getByPlaceholder("Search or create category...");
    await categoryInput.click();
    await categoryInput.fill(withTs("Amendments", ts));
    await page
      .getByRole("option", { name: new RegExp(withTs("Amendments", ts)) })
      .first()
      .click();
    await expect(page.getByRole("listbox")).not.toBeVisible();

    // Use Pound unit (created earlier)
    await page.locator("#unitDefinitionId").click();
    await page
      .getByRole("option", { name: new RegExp(withTs("Pound", ts)) })
      .click();

    await page.getByLabel("Selling Price").fill("28.00");

    // ── BOM: 8 amendment ingredients ──
    const bomIngredients = [
      { name: withTs("Kelp Meal", ts), qty: "2" },
      { name: withTs("Fish Bone Meal", ts), qty: "3" },
      { name: withTs("Feather Meal", ts), qty: "2.5" },
      { name: withTs("Oyster Shell Flour", ts), qty: "4" },
      { name: withTs("Gypsum", ts), qty: "3" },
      { name: withTs("Dolomite Lime", ts), qty: "2" },
      { name: withTs("Greensand", ts), qty: "1.5" },
      { name: withTs("Azomite", ts), qty: "1" },
    ];

    for (const ingredient of bomIngredients) {
      await page.getByText("+ Add Ingredient").click();
      const row = page.locator("tbody tr").last();
      await row.getByPlaceholder("Search items...").click();
      await row.getByPlaceholder("Search items...").fill(ingredient.name);
      await page.getByRole("option", { name: ingredient.name }).click();
      await row.locator("input[inputmode='decimal']").fill(ingredient.qty);
      // Click outside to close any lingering popover
      await page.getByText("Recipe / Bill of Materials").click();
    }

    await page.getByRole("button", { name: "Create Product" }).click();
    await page.waitForURL(/\/inventory\/products\/[0-9a-f-]+$/);

    // ── UI verification ──
    await expect(page.getByRole("heading", { name })).toBeVisible();
    const bomTable = page.locator("table").first();
    await expect(bomTable).toContainText(withTs("Kelp Meal", ts));
    await expect(bomTable).toContainText(withTs("Azomite", ts));
    await expect(page.locator("body")).not.toContainText("Invalid");

    // ── DB verification ──
    const rows = await db.select().from(items).where(eq(items.name, name));
    expect(rows).toHaveLength(1);

    const product = rows[0];
    nutePackId = product.id;

    expect(product.itemType).toBe("product");
    expect(product.defaultSellingPrice).toBe("28.00");

    const bomRows = await db
      .select()
      .from(bomComponents)
      .where(eq(bomComponents.itemId, product.id));
    expect(bomRows).toHaveLength(8);

    const bomByComponent = new Map(
      bomRows.map((r) => [r.componentId, r.quantity])
    );
    expect(bomByComponent.get(kelpMealId)).toBe("2.0000");
    expect(bomByComponent.get(fishBoneMealId)).toBe("3.0000");
    expect(bomByComponent.get(featherMealId)).toBe("2.5000");
    expect(bomByComponent.get(oysterShellFlourId)).toBe("4.0000");
    expect(bomByComponent.get(gypsumId)).toBe("3.0000");
    expect(bomByComponent.get(dolomiteLimeId)).toBe("2.0000");
    expect(bomByComponent.get(greensandId)).toBe("1.5000");
    expect(bomByComponent.get(azomiteId)).toBe("1.0000");
  });

  /* ══════════════════════════════════════════════════════════════════
     9. Creates The Bomb Original/Coco with BOM
     ══════════════════════════════════════════════════════════════════ */

  test("creates The Bomb Original/Coco with BOM", async ({ page, db }) => {
    const name = withTs("The Bomb Original/Coco", ts);

    await page.goto("/inventory/products/new");
    await expect(page.getByText("Add Product")).toBeVisible();

    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Description").fill(
      "Complete living soil — coco base with full nutrient pack"
    );

    const categoryInput = page.getByPlaceholder("Search or create category...");
    await categoryInput.click();
    await categoryInput.fill(withTs("Bases", ts));
    await page
      .getByRole("option", { name: new RegExp(withTs("Bases", ts)) })
      .first()
      .click();
    await expect(page.getByRole("listbox")).not.toBeVisible();

    // Use Bag unit
    await page.locator("#unitDefinitionId").click();
    await page
      .getByRole("option", { name: new RegExp(withTs("Bag", ts)) })
      .click();

    await page.getByLabel("Selling Price").fill("89.99");

    // ── BOM: 4 bases + 1 sub-assembly ──
    const bomIngredients = [
      { name: withTs("Coconut Coir", ts), qty: "4" },
      { name: withTs("Perlite", ts), qty: "2" },
      { name: withTs("Rice Hulls", ts), qty: "1" },
      { name: withTs("Worm Castings", ts), qty: "2" },
      { name: withTs("Bomb Nute Pack", ts), qty: "1" },
    ];

    for (const ingredient of bomIngredients) {
      await page.getByText("+ Add Ingredient").click();
      const row = page.locator("tbody tr").last();
      await row.getByPlaceholder("Search items...").click();
      await row.getByPlaceholder("Search items...").fill(ingredient.name);
      await page.getByRole("option", { name: ingredient.name }).click();
      await row.locator("input[inputmode='decimal']").fill(ingredient.qty);
      await page.getByText("Recipe / Bill of Materials").click();
    }

    await page.getByRole("button", { name: "Create Product" }).click();
    await page.waitForURL(/\/inventory\/products\/[0-9a-f-]+$/);

    // ── UI verification ──
    await expect(page.getByRole("heading", { name })).toBeVisible();
    const bomTable = page.locator("table").first();
    await expect(bomTable).toContainText(withTs("Coconut Coir", ts));
    await expect(bomTable).toContainText(withTs("Bomb Nute Pack", ts));
    await expect(page.locator("body")).not.toContainText("Invalid");

    // ── DB verification ──
    const rows = await db.select().from(items).where(eq(items.name, name));
    expect(rows).toHaveLength(1);

    const product = rows[0];
    theBombId = product.id;

    expect(product.itemType).toBe("product");
    expect(product.defaultSellingPrice).toBe("89.99");

    const bomRows = await db
      .select()
      .from(bomComponents)
      .where(eq(bomComponents.itemId, product.id));
    expect(bomRows).toHaveLength(5);

    const bomByComponent = new Map(
      bomRows.map((r) => [r.componentId, r.quantity])
    );
    expect(bomByComponent.get(coconutCoirId)).toBe("4.0000");
    expect(bomByComponent.get(perliteId)).toBe("2.0000");
    expect(bomByComponent.get(riceHullsId)).toBe("1.0000");
    expect(bomByComponent.get(wormCastingsId)).toBe("2.0000");
    expect(bomByComponent.get(nutePackId)).toBe("1.0000");
  });

  /* ══════════════════════════════════════════════════════════════════
     10. Creates Pro Base Coco with BOM (3 base ingredients)
     ══════════════════════════════════════════════════════════════════ */

  test("creates Pro Base Coco with BOM", async ({ page, db }) => {
    const name = withTs("Pro Base Coco", ts);

    await page.goto("/inventory/products/new");
    await expect(page.getByText("Add Product")).toBeVisible();

    await page.getByLabel("Name").fill(name);

    const categoryInput = page.getByPlaceholder("Search or create category...");
    await categoryInput.click();
    await categoryInput.fill(withTs("Bases", ts));
    await page
      .getByRole("option", { name: new RegExp(withTs("Bases", ts)) })
      .first()
      .click();
    await expect(page.getByRole("listbox")).not.toBeVisible();

    // Use Bag unit
    await page.locator("#unitDefinitionId").click();
    await page
      .getByRole("option", { name: new RegExp(withTs("Bag", ts)) })
      .click();

    await page.getByLabel("Selling Price").fill("39.99");

    // ── BOM: 3 base ingredients (no nute pack) ──
    const bomIngredients = [
      { name: withTs("Coconut Coir", ts), qty: "5" },
      { name: withTs("Perlite", ts), qty: "3" },
      { name: withTs("Rice Hulls", ts), qty: "2" },
    ];

    for (const ingredient of bomIngredients) {
      await page.getByText("+ Add Ingredient").click();
      const row = page.locator("tbody tr").last();
      await row.getByPlaceholder("Search items...").click();
      await row.getByPlaceholder("Search items...").fill(ingredient.name);
      await page.getByRole("option", { name: ingredient.name }).click();
      await row.locator("input[inputmode='decimal']").fill(ingredient.qty);
      await page.getByText("Recipe / Bill of Materials").click();
    }

    await page.getByRole("button", { name: "Create Product" }).click();
    await page.waitForURL(/\/inventory\/products\/[0-9a-f-]+$/);

    // ── UI verification ──
    await expect(page.getByRole("heading", { name })).toBeVisible();
    const bomTable = page.locator("table").first();
    await expect(bomTable).toContainText(withTs("Coconut Coir", ts));
    await expect(bomTable).toContainText(withTs("Rice Hulls", ts));
    await expect(page.locator("body")).not.toContainText("Invalid");

    // ── DB verification ──
    const rows = await db.select().from(items).where(eq(items.name, name));
    expect(rows).toHaveLength(1);

    const product = rows[0];
    proBaseCocoId = product.id;

    expect(product.itemType).toBe("product");
    expect(product.defaultSellingPrice).toBe("39.99");

    const bomRows = await db
      .select()
      .from(bomComponents)
      .where(eq(bomComponents.itemId, product.id));
    expect(bomRows).toHaveLength(3);

    const bomByComponent = new Map(
      bomRows.map((r) => [r.componentId, r.quantity])
    );
    expect(bomByComponent.get(coconutCoirId)).toBe("5.0000");
    expect(bomByComponent.get(perliteId)).toBe("3.0000");
    expect(bomByComponent.get(riceHullsId)).toBe("2.0000");
  });

  /* ══════════════════════════════════════════════════════════════════
     11. Creates a simple product without BOM (stock=50) — coverage
     ══════════════════════════════════════════════════════════════════ */

  test("creates a simple product without BOM", async ({ page, db }) => {
    const name = withTs("Starter Kit", ts);

    await page.goto("/inventory/products/new");
    await expect(page.getByText("Add Product")).toBeVisible();

    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Description").fill("Beginner gardening bundle");
    await page.getByLabel("SKU").fill(`PROD-START-${ts}`);

    const categoryInput = page.getByPlaceholder("Search or create category...");
    await categoryInput.click();
    await categoryInput.fill(withTs("Kits", ts));
    await page
      .getByRole("option", { name: new RegExp(withTs("Kits", ts)) })
      .first()
      .click();
    await expect(page.getByRole("listbox")).not.toBeVisible();

    await page.locator("#unitDefinitionId").click();
    await page.getByRole("option").first().click();

    await page.getByLabel("Selling Price").fill("25.00");
    await page.getByLabel("Safety Stock").fill("10");

    await page.getByRole("button", { name: "Create Product" }).click();
    await page.waitForURL(/\/inventory\/products\/[0-9a-f-]+$/);

    // ── UI verification ──
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByText("Beginner gardening bundle")).toBeVisible();
    await expect(page.getByText(`PROD-START-${ts}`)).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Invalid");

    // ── DB verification ──
    const rows = await db.select().from(items).where(eq(items.name, name));
    expect(rows).toHaveLength(1);

    const product = rows[0];
    simpleProductId = product.id;

    expect(product.itemType).toBe("product");
    expect(product.category).toBe(withTs("Kits", ts));
    expect(product.defaultSellingPrice).toBe("25.00");
    expect(product.safetyStock).toBe("10.0000");

    // No BOM
    const bomRows = await db
      .select()
      .from(bomComponents)
      .where(eq(bomComponents.itemId, product.id));
    expect(bomRows).toHaveLength(0);

    // No stock (no BOM = no cost basis for lots)
    const lotRows = await db
      .select()
      .from(lots)
      .where(eq(lots.itemId, product.id));
    expect(lotRows).toHaveLength(0);
  });

  /* ══════════════════════════════════════════════════════════════════
     12. Edits The Bomb — verifies BOM pre-populated, changes price
     ══════════════════════════════════════════════════════════════════ */

  test("edits The Bomb — verifies BOM pre-populated, changes selling price", async ({
    page,
    db,
  }) => {
    await page.goto(`/inventory/products/${theBombId}`);
    await expect(
      page.getByRole("heading", { name: withTs("The Bomb Original/Coco", ts) })
    ).toBeVisible();
    await page.getByRole("link", { name: "Edit" }).click();
    await expect(page.getByText("Edit Product")).toBeVisible();

    // ── Verify pre-population ──
    await expect(page.getByLabel("Name")).toHaveValue(
      withTs("The Bomb Original/Coco", ts)
    );
    await expect(page.getByLabel("Description")).toHaveValue(
      "Complete living soil — coco base with full nutrient pack"
    );
    await expect(page.getByLabel("Selling Price")).toHaveValue("89.99");

    // Verify BOM rows are pre-populated (5 rows)
    const bomRows = page.locator("tbody tr");
    await expect(bomRows).toHaveCount(5);

    // ── Change selling price ──
    await page.getByLabel("Selling Price").fill("94.99");

    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.waitForURL(`**/inventory/products/${theBombId}`);

    // ── UI verification ──
    await expect(
      page.getByRole("heading", { name: withTs("The Bomb Original/Coco", ts) })
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Invalid");

    // ── DB verification ──
    const [updated] = await db
      .select()
      .from(items)
      .where(eq(items.id, theBombId));
    expect(updated.defaultSellingPrice).toBe("94.99");
    // Description unchanged
    expect(updated.description).toBe(
      "Complete living soil — coco base with full nutrient pack"
    );

    // BOM should still have 5 ingredients
    const bom = await db
      .select()
      .from(bomComponents)
      .where(eq(bomComponents.itemId, theBombId));
    expect(bom).toHaveLength(5);
  });
});
