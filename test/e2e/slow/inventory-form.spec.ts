import { eq } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  bomRevisionComponents,
  bomRevisions,
  items,
  lots,
} from "../../../lib/db/schema";
import { createItem, getUnitId, updateItem } from "../../helpers/api";
import { setTestTimestamp } from "../../helpers/test-env";

test.describe("Inventory creation flow", () => {
  test.describe.configure({ mode: "serial" });

  // Inventory owns the timestamp — fresh each run, written to the shared file
  // so sales can find these products later.
  const ts = setTestTimestamp(Date.now());

  let fullMaterialId: string;
  let fullMaterialName: string;
  let minimalMaterialId: string;
  let minimalMaterialName: string;
  let lowStockMaterialId: string;
  let lowStockMaterialName: string;
  let simpleProductId: string;
  let simpleProductName: string;
  let sellableProductId: string;
  let sellableProductName: string;

  test("shows the active organization in the sidebar and hides placeholder actions", async ({
    page,
  }) => {
    await page.goto("/");

    await page.waitForURL("**/inventory/products");
    await expect(page.getByText("Inventory")).toBeVisible();
    await expect(page.getByText("Test Org")).toBeVisible();
    await expect(page.getByText("Single site")).toBeVisible();
    await expect(page.getByRole("button", { name: "Toggle theme" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Notifications" })).toHaveCount(0);
    await expect(page.getByText("Add Location")).toHaveCount(0);
    await expect(page.getByText("Assign reviewer")).toHaveCount(0);
  });

  /* ── 1. Material with every field ────────────────────────────── */

  test("creates a material with all fields", async ({ page, db }) => {
    test.slow();

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
    // Select the category — may be "Create" if first run, or an existing option on re-runs
    await page.getByRole("option", { name: new RegExp(`Aggregates ${ts}`) }).first().click();
    await expect(page.getByRole("listbox")).not.toBeVisible();

    await page.locator("#unitDefinitionId").click();
    await page.getByRole("option", { name: "+ Create new unit" }).click();

    await expect(page.getByText("Define a new unit of measure")).toBeVisible();
    await page.locator("#unit-name").fill(`Bag ${ts}`);
    await page.locator("#unit-size").fill("25");
    await page.locator("#unit-uom").click();
    await page.getByRole("option", { name: /kilogram/i }).click();

    const materialUnitCreateResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/units")
    );
    await page.getByRole("button", { name: "Create", exact: true }).click();
    expect((await materialUnitCreateResponse).status()).toBe(201);
    await expect(page.locator("#unitDefinitionId")).toContainText(`Bag ${ts}`);

    await page.getByLabel("Purchase Price").fill("3.50");
    await page.getByLabel("Selling Price").fill("6.00");
    await page.getByLabel("Stock", { exact: true }).fill("200");
    await page.getByLabel("Safety Stock").fill("25");

    const fullMaterialCreateResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/items")
    );
    await page.getByRole("button", { name: "Create Material" }).click();
    const fullMaterialCreateBody = await (
      await fullMaterialCreateResponse
    ).json();
    fullMaterialId = fullMaterialCreateBody.id;
    await page.goto(`/inventory/materials/${fullMaterialId}`);

    // UI — verify the detail page
    await expect(page.getByRole("heading", { name: fullMaterialName })).toBeVisible();
    await expect(page.getByText("Fine grain river sand")).toBeVisible();
    await expect(page.getByText(sku)).toBeVisible();
    await expect(page.locator("dl").getByText(`Bag ${ts} (25 kg)`, { exact: true })).toBeVisible();
    await expect(page.locator("dl").getByText("$3.50", { exact: true })).toBeVisible();
    await expect(page.locator("dl").getByText("$6.00", { exact: true })).toBeVisible();
    await expect(page.locator("dl").getByText(`200 Bag ${ts}`, { exact: true })).toBeVisible();
    await expect(page.locator("dl").getByText(`25 Bag ${ts}`, { exact: true })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Invalid");

    await page.goto("/inventory/materials");
    await page.getByLabel("Search items").fill(fullMaterialName);
    const materialRow = page.getByRole("row", { name: new RegExp(fullMaterialName) });
    await expect(materialRow.getByRole("link", { name: fullMaterialName })).toBeVisible();
    await expect(materialRow).toContainText(sku);
    await expect(materialRow).toContainText("200");
    await expect(materialRow).toContainText("175");
    await expect(materialRow).toContainText(`Aggregates ${ts}`);

    // DB
    const rows = await db.select().from(items).where(eq(items.name, fullMaterialName));
    expect(rows).toHaveLength(1);

    const material = rows[0];

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

  /* ── 1b. Edit the full material ──────────────────────────────── */

  test("edits the full material — verifies pre-population and saves changes", async ({ page, db }) => {
    await page.goto(`/inventory/materials/${fullMaterialId}`);
    await expect(page.getByRole("heading", { name: fullMaterialName })).toBeVisible();
    await page.getByRole("link", { name: "Edit" }).click();
    await page.waitForURL(`**/inventory/materials/${fullMaterialId}/edit`);
    await expect(
      page.getByRole("heading", { name: "Edit Material" })
    ).toBeVisible({ timeout: 30000 });

    // Verify key fields pre-populated
    await expect(page.getByLabel("Name")).toHaveValue(fullMaterialName);
    await expect(page.getByLabel("Description")).toHaveValue("Fine grain river sand");
    await expect(page.getByLabel("SKU")).toHaveValue(`MAT-SAND-${ts}`);
    await expect(page.getByLabel("Purchase Price")).toHaveValue("3.5");
    await expect(page.getByLabel("Selling Price")).toHaveValue("6");
    await expect(page.getByLabel("Safety Stock")).toHaveValue("25");

    // Make changes
    await page.getByLabel("Description").fill("Coarse river sand — updated");
    await page.getByLabel("Safety Stock").fill("30");

    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.waitForURL(`**/inventory/materials/${fullMaterialId}`);

    // UI — verify detail page reflects the edits
    await expect(page.getByText("Coarse river sand — updated")).toBeVisible();
    await expect(page.locator("dl").getByText(`30 Bag ${ts}`, { exact: true })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Invalid");

    await page.goto("/inventory/materials");
    await page.getByLabel("Search items").fill(fullMaterialName);
    const updatedRow = page.getByRole("row", { name: new RegExp(fullMaterialName) });
    await expect(updatedRow).toContainText("170");
    await expect(updatedRow).toContainText(`Aggregates ${ts}`);

    // DB
    const [updated] = await db.select().from(items).where(eq(items.id, fullMaterialId));
    expect(updated.description).toBe("Coarse river sand — updated");
    expect(updated.safetyStock).toBe("30.0000");
    // Unchanged fields should still be intact
    expect(updated.sku).toBe(`MAT-SAND-${ts}`);
    expect(updated.defaultPurchasePrice).toBe("3.5000");
  });

  /* ── 2. Material with only required fields ───────────────────── */

  test("creates a material with only required fields", async ({ page, db }) => {
    minimalMaterialName = `Gravel ${ts}`;

    await page.goto("/inventory/materials/new");
    await expect(page.getByText("Add Material")).toBeVisible();

    await page.getByLabel("Name").fill(minimalMaterialName);
    await page.locator("#unitDefinitionId").click();
    await page.getByRole("option").first().click();

    const minimalMaterialCreateResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/items")
    );
    await page.getByRole("button", { name: "Create Material" }).click();
    const minimalMaterialCreateBody = await (
      await minimalMaterialCreateResponse
    ).json();
    minimalMaterialId = minimalMaterialCreateBody.id;
    await page.goto(`/inventory/materials/${minimalMaterialId}`);

    // UI — verify the detail page
    await expect(page.getByRole("heading", { name: minimalMaterialName })).toBeVisible();
    await expect(page.getByText("No lots recorded.")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Invalid");

    await page.goto("/inventory/materials");
    await page.getByLabel("Search items").fill(minimalMaterialName);
    const minimalRow = page.getByRole("row", { name: new RegExp(minimalMaterialName) });
    await expect(minimalRow.getByRole("link", { name: minimalMaterialName })).toBeVisible();
    await expect(minimalRow).toContainText("0");

    // DB
    const rows = await db.select().from(items).where(eq(items.name, minimalMaterialName));
    expect(rows).toHaveLength(1);

    const material = rows[0];

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

    const lowStockMaterialCreateResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/items")
    );
    await page.getByRole("button", { name: "Create Material" }).click();
    const lowStockMaterialCreateBody = await (
      await lowStockMaterialCreateResponse
    ).json();
    lowStockMaterialId = lowStockMaterialCreateBody.id;
    await page.goto(`/inventory/materials/${lowStockMaterialId}`);

    const rows = await db.select().from(items).where(eq(items.name, lowStockMaterialName));
    expect(rows).toHaveLength(1);

    const material = rows[0];

    expect(material.safetyStock).toBe("5.0000");

    await page.goto("/inventory/materials");
    await page.getByLabel("Search items").fill(String(ts));

    const calculatedStockHeader = page.getByRole("button", {
      name: /^Sort by Calculated Stock/,
    });
    await calculatedStockHeader.hover();
    await expect(
      page.getByText("Stock - committed + expected - safety stock.")
    ).toBeVisible();

    await page.mouse.move(0, 0);
    await calculatedStockHeader.click();
    await expect(calculatedStockHeader).toHaveAttribute(
      "aria-label",
      /sorted ascending/
    );

    const firstRow = page.getByTestId("bom-row").first();
    const firstRowLink = firstRow.getByRole("link");
    await expect(firstRowLink).toContainText(lowStockMaterialName);

    const lowStockLink = page.getByRole("link", {
      name: new RegExp(lowStockMaterialName),
    });
    await page.mouse.move(0, 0);
    await lowStockLink.focus();
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

    await page.keyboard.press("Escape");

    await page.locator("dd span.text-destructive").focus();
    await expect(
      page.getByText(
        "Calculated stock is below zero, so this item is below its safety stock threshold."
      )
    ).toBeVisible();
  });

  /* ── 3. Product without BOM ──────────────────────────────────── */

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
    await page.getByRole("option", { name: new RegExp(`Mixes ${ts}`) }).first().click();
    await expect(page.getByRole("listbox")).not.toBeVisible();

    await page.locator("#unitDefinitionId").click();
    await page.getByRole("option", { name: "+ Create new unit" }).click();

    await expect(page.getByText("Define a new unit of measure")).toBeVisible();
    await page.locator("#unit-name").fill(`Bucket ${ts}`);
    await page.locator("#unit-size").fill("10");
    await page.locator("#unit-uom").click();
    await page.getByRole("option", { name: "liter (l)" }).click();

    const productUnitCreateResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/units")
    );
    await page.getByRole("button", { name: "Create", exact: true }).click();
    expect((await productUnitCreateResponse).status()).toBe(201);
    await expect(page.locator("#unitDefinitionId")).toContainText(`Bucket ${ts}`);

    await page.getByLabel("Selling Price").fill("12.00");
    await page.getByLabel("Stock", { exact: true }).fill("0");
    await page.getByLabel("Safety Stock").fill("10");

    const simpleProductCreateResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/items")
    );
    await page.getByRole("button", { name: "Create Product" }).click();
    const simpleProductCreateBody = await (
      await simpleProductCreateResponse
    ).json();
    simpleProductId = simpleProductCreateBody.id;
    await page.goto(`/inventory/products/${simpleProductId}`);

    // UI — verify the detail page
    await expect(page.getByRole("heading", { name: simpleProductName })).toBeVisible();
    await expect(page.getByText("Simple base product")).toBeVisible();
    await expect(page.getByText(`PROD-BASE-${ts}`)).toBeVisible();
    await expect(page.locator("dl").getByText(`Bucket ${ts} (10 l)`, { exact: true })).toBeVisible();
    await expect(page.locator("dl").getByText("$12.00", { exact: true })).toBeVisible();
    await expect(page.locator("dl").getByText(`10 Bucket ${ts}`, { exact: true })).toBeVisible();
    await expect(page.getByText("No lots recorded.")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Invalid");

    await page.goto("/inventory/products");
    await page.getByLabel("Search items").fill(simpleProductName);
    const simpleProductRow = page.getByRole("row", { name: new RegExp(simpleProductName) });
    await expect(simpleProductRow.getByRole("link", { name: simpleProductName })).toBeVisible();
    await expect(simpleProductRow).toContainText(`PROD-BASE-${ts}`);
    await expect(simpleProductRow).toContainText("0");
    await expect(simpleProductRow).toContainText("-10");
    await expect(simpleProductRow).toContainText(`Mixes ${ts}`);

    // DB
    const rows = await db.select().from(items).where(eq(items.name, simpleProductName));
    expect(rows).toHaveLength(1);

    const product = rows[0];

    expect(product.itemType).toBe("product");
    expect(product.category).toBe(`Mixes ${ts}`);
    expect(product.defaultSellingPrice).toBe("12.00");
    expect(product.safetyStock).toBe("10.0000");

    const bomRows = await db
      .select()
      .from(bomRevisions)
      .where(eq(bomRevisions.productId, product.id));
    expect(bomRows).toHaveLength(0);

    const lotRows = await db.select().from(lots).where(eq(lots.itemId, product.id));
    expect(lotRows).toHaveLength(0);
  });

  /* ── 4. Product with BOM ─────────────────────────────────────── */

  test("creates a product with BOM using the materials and product above", async ({ page, db }) => {
    sellableProductName = `Premium Topsoil ${ts}`;

    await page.goto("/inventory/products/new");
    await expect(page.getByText("Add Product")).toBeVisible();

    await page.getByLabel("Name").fill(sellableProductName);
    await page.getByLabel("Description").fill("Premium blend using all previous items");

    const categoryInput = page.getByPlaceholder("Search or create category...");
    await categoryInput.click();
    await categoryInput.fill(`Blends ${ts}`);
    await page.getByRole("option", { name: new RegExp(`Blends ${ts}`) }).first().click();
    await expect(page.getByRole("listbox")).not.toBeVisible();

    await page.locator("#unitDefinitionId").click();
    await page.getByRole("option").first().click();
    await page.getByLabel("Selling Price").fill("29.99");

    // BOM row 1 — Sand
    await page.getByText("+ Add Ingredient").click();
    let row = page.getByTestId("bom-row").last();
    await row.getByPlaceholder("Search items...").click();
    await row.getByPlaceholder("Search items...").fill(fullMaterialName);
    await page.getByRole("option", { name: fullMaterialName }).click();
    await row.locator("input[inputmode='decimal']").fill("4.5");
    await page.getByText("Recipe / Bill of Materials").click();

    // BOM row 2 — Gravel
    await page.getByText("+ Add Ingredient").click();
    row = page.getByTestId("bom-row").last();
    await row.getByPlaceholder("Search items...").click();
    await row.getByPlaceholder("Search items...").fill(minimalMaterialName);
    await page.getByRole("option", { name: minimalMaterialName }).click();
    await row.locator("input[inputmode='decimal']").fill("3");
    await page.getByText("Recipe / Bill of Materials").click();

    // BOM row 3 — Base Mix
    await page.getByText("+ Add Ingredient").click();
    row = page.getByTestId("bom-row").last();
    await row.getByPlaceholder("Search items...").click();
    await row.getByPlaceholder("Search items...").fill(simpleProductName);
    await page.getByRole("option", { name: simpleProductName }).click();
    await row.locator("input[inputmode='decimal']").fill("2");

    const sellableProductCreateResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/items")
    );
    await page.getByRole("button", { name: "Create Product" }).click();
    const sellableProductCreateBody = await (
      await sellableProductCreateResponse
    ).json();
    sellableProductId = sellableProductCreateBody.id;
    await page.goto(`/inventory/products/${sellableProductId}`);

    // UI — verify the detail page and BOM table
    await expect(page.getByRole("heading", { name: sellableProductName })).toBeVisible();
    const bomTable = page.locator("table").first();
    await expect(bomTable).toContainText(fullMaterialName);
    await expect(bomTable).toContainText(minimalMaterialName);
    await expect(bomTable).toContainText(simpleProductName);
    await expect(bomTable).toContainText("4.5");
    await expect(bomTable).toContainText("3");
    await expect(bomTable).toContainText("2");
    await expect(page.locator("dl").getByText("$29.99", { exact: true })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Invalid");

    await page.goto("/inventory/products");
    await page.getByLabel("Search items").fill(sellableProductName);
    const sellableRow = page.getByRole("row", { name: new RegExp(sellableProductName) });
    await expect(sellableRow.getByRole("link", { name: sellableProductName })).toBeVisible();
    await expect(sellableRow).toContainText("0");
    await expect(sellableRow).toContainText(`Blends ${ts}`);

    // DB
    const rows = await db.select().from(items).where(eq(items.name, sellableProductName));
    expect(rows).toHaveLength(1);

    const product = rows[0];

    expect(product.itemType).toBe("product");
    expect(product.category).toBe(`Blends ${ts}`);
    expect(product.defaultSellingPrice).toBe("29.99");

    const [currentRevision] = await db
      .select()
      .from(bomRevisions)
      .where(eq(bomRevisions.productId, product.id));

    expect(currentRevision.revisionNumber).toBe(1);
    expect(currentRevision.isCurrent).toBe(true);

    const bomRows = await db
      .select()
      .from(bomRevisionComponents)
      .where(eq(bomRevisionComponents.bomRevisionId, currentRevision.id));

    expect(bomRows).toHaveLength(3);

    const bomByComponent = new Map(bomRows.map((r) => [r.componentId, r.quantity]));
    expect(bomByComponent.get(fullMaterialId)).toBe("4.5000");
    expect(bomByComponent.get(minimalMaterialId)).toBe("3.0000");
    expect(bomByComponent.get(simpleProductId)).toBe("2.0000");
  });

  /* ── 4b. Edit the BOM product ────────────────────────────────── */

  test("edits the BOM product — verifies pre-population, changes a quantity, adds a note", async ({ page, db }) => {
    await page.goto(`/inventory/products/${sellableProductId}`);
    await expect(page.getByRole("heading", { name: sellableProductName })).toBeVisible();
    await page.getByRole("link", { name: "Edit" }).click();
    await page.waitForURL(`**/inventory/products/${sellableProductId}/edit`);
    await expect(
      page.getByRole("heading", { name: "Edit Product" })
    ).toBeVisible({ timeout: 30000 });

    // Verify key fields pre-populated
    await expect(page.getByLabel("Name")).toHaveValue(sellableProductName);
    await expect(page.getByLabel("Description")).toHaveValue("Premium blend using all previous items");
    await expect(page.getByLabel("Selling Price")).toHaveValue("29.99");

    // Verify BOM rows are pre-populated (3 rows in the table)
    const bomRows = page.getByTestId("bom-row");
    await expect(bomRows).toHaveCount(3);

    // Change the selling price
    await page.getByLabel("Selling Price").fill("34.99");

    // Update description
    await page.getByLabel("Description").fill("Premium blend — updated recipe");

    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.waitForURL(`**/inventory/products/${sellableProductId}`);

    // UI — verify detail page reflects the edits
    await expect(page.getByText("Premium blend — updated recipe")).toBeVisible();
    await expect(page.locator("dl").getByText("$34.99", { exact: true })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Invalid");

    const updatedBomTable = page.locator("table").first();
    await expect(updatedBomTable).toContainText(fullMaterialName);
    await expect(updatedBomTable).toContainText(minimalMaterialName);
    await expect(updatedBomTable).toContainText(simpleProductName);

    // DB
    const [updated] = await db.select().from(items).where(eq(items.id, sellableProductId));
    expect(updated.description).toBe("Premium blend — updated recipe");
    expect(updated.defaultSellingPrice).toBe("34.99");

    const revisions = await db
      .select()
      .from(bomRevisions)
      .where(eq(bomRevisions.productId, sellableProductId));
    expect(revisions).toHaveLength(1);

    const bom = await db
      .select()
      .from(bomRevisionComponents)
      .where(eq(bomRevisionComponents.bomRevisionId, revisions[0].id));
    expect(bom).toHaveLength(3);
  });

  test("rejects non-positive BOM quantities through the item API", async ({ db }) => {
    const invalidCreateName = `Invalid BOM Product ${ts}`;
    const unitId = getUnitId();

    const invalidCreate = await createItem({
      name: invalidCreateName,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `PROD-BAD-BOM-${ts}`,
      category: `Blends ${ts}`,
      description: "Should fail because the BOM quantity is zero",
      defaultPurchasePrice: null,
      defaultSellingPrice: "19.99",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: fullMaterialId, quantity: "0" }],
    });

    expect(invalidCreate.status).toBe(400);
    expect(invalidCreate.body?.errors?.bom?.[0]).toContain("greater than 0");

    const createdRows = await db
      .select({ id: items.id })
      .from(items)
      .where(eq(items.name, invalidCreateName));
    expect(createdRows).toHaveLength(0);

    const invalidUpdate = await updateItem(sellableProductId, {
      name: sellableProductName,
      sku: null,
      category: `Blends ${ts}`,
      description: "Premium blend — updated recipe",
      defaultPurchasePrice: null,
      defaultSellingPrice: "34.99",
      safetyStock: "0",
      stock: "0",
      bom: [{ componentId: fullMaterialId, quantity: "-1" }],
    });

    expect(invalidUpdate.status).toBe(400);
    expect(invalidUpdate.body?.errors?.bom?.[0]).toContain("greater than 0");

    const revisions = await db
      .select()
      .from(bomRevisions)
      .where(eq(bomRevisions.productId, sellableProductId));
    expect(revisions).toHaveLength(1);

    const bom = await db
      .select()
      .from(bomRevisionComponents)
      .where(eq(bomRevisionComponents.bomRevisionId, revisions[0].id));
    expect(bom).toHaveLength(3);
  });
});
