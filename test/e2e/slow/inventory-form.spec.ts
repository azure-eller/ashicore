import { eq } from "drizzle-orm";
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import {
  bomRevisionComponents,
  bomRevisions,
  items,
  lots,
} from "../../../lib/db/schema";
import { createItem, getUnitId, updateItem } from "../../helpers/api";
import { setTestTimestamp } from "../../helpers/test-env";

async function createCardItem(
  page: Page,
  itemType: "material" | "product",
  name: string,
) {
  const draftSegment = itemType === "material" ? "material" : "product";
  await page.goto(`/inventory/${draftSegment}`);
  const label = itemType === "material" ? "Material name" : "Product name";
  const input = page.getByLabel(label);
  await expect(input).toBeVisible();
  await input.fill(name);

  const [createResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/item-cards"),
    ),
    input.blur(),
  ]);
  expect(createResponse.status()).toBe(201);
  const body = await createResponse.json();
  return (body.itemId ?? body.id) as string;
}

async function patchCardField(
  page: Page,
  itemId: string,
  label: string,
  value: string,
) {
  const field = page.getByLabel(label);
  // `fill` against a controlled React textarea sometimes leaves prior content
  // intact and prepends — clear first to force a clean replacement.
  await field.click();
  await field.clear();
  await field.fill(value);
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === "PATCH" &&
        r.url().includes(`/api/item-cards/${itemId}`),
    ),
    field.blur(),
  ]);
  expect(response.status()).toBe(200);
}

async function addBomIngredient(
  page: Page,
  componentName: string,
  quantity: string,
) {
  // Always click Add ingredient — the new row auto-enters edit mode, exposing
  // a single `Search items...` placeholder input regardless of how many rows
  // already exist.
  await page.getByRole("button", { name: "Add ingredient" }).click();
  const componentInput = page.getByPlaceholder("Search items...").first();
  await expect(componentInput).toBeVisible();
  await componentInput.click();
  await componentInput.fill(componentName);
  await page.getByRole("option", { name: componentName }).click();

  const materialsGrid = page.locator('[data-slot="editable-line-data-grid"]').first();
  const row = materialsGrid
    .locator(".ag-center-cols-container .ag-row", { hasText: componentName })
    .first();
  await expect(row).toBeVisible();

  const quantityCell = row.locator('[col-id="quantity"]').first();
  await quantityCell.click();
  const editor = quantityCell.locator("input").first();
  await expect(editor).toBeVisible();
  await editor.fill(quantity);
  await editor.press("Enter");
}

test.describe("Inventory card flow", () => {
  test.describe.configure({ mode: "serial" });

  // Inventory owns the timestamp — fresh each run, written to the shared file
  // so sales/manufacturing can find these items later.
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
    await page.goto("/inventory/materials");
    await expect(page.getByRole("link", { name: "Inventory", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "ERP Agent message" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Notifications" })).toHaveCount(0);
    await expect(page.getByText("Add Location")).toHaveCount(0);
    await expect(page.getByText("Assign reviewer")).toHaveCount(0);
    await expect(page.getByText("Single site")).toHaveCount(0);
  });

  /* ── 1. Material with description + category ──────────────────── */

  test("creates a material with descriptive fields via the card UI", async ({
    page,
    db,
  }) => {
    test.slow();

    fullMaterialName = `Sand ${ts}`;
    fullMaterialId = await createCardItem(page, "material", fullMaterialName);

    await page.waitForURL(`**/inventory/materials/${fullMaterialId}*`);
    await expect(page.getByRole("heading", { name: fullMaterialName })).toBeVisible();

    await patchCardField(page, fullMaterialId, "Additional info", "Fine grain river sand");
    await patchCardField(page, fullMaterialId, "Category", `Aggregates ${ts}`);

    await page.reload();
    await expect(page.getByRole("heading", { name: fullMaterialName })).toBeVisible();
    await expect(page.getByLabel("Additional info")).toHaveValue("Fine grain river sand");
    await expect(page.getByLabel("Category")).toHaveValue(`Aggregates ${ts}`);

    await page.goto("/inventory/materials");
    await page.getByLabel("Search items").fill(fullMaterialName);
    const materialRow = page.getByRole("row", { name: new RegExp(fullMaterialName) });
    await expect(materialRow.getByRole("link", { name: fullMaterialName })).toBeVisible();
    await expect(materialRow).toContainText(`Aggregates ${ts}`);

    const rows = await db.select().from(items).where(eq(items.name, fullMaterialName));
    expect(rows).toHaveLength(1);

    const material = rows[0];
    expect(material.itemType).toBe("material");
    expect(material.description).toBe("Fine grain river sand");
    expect(material.category).toBe(`Aggregates ${ts}`);
  });

  /* ── 1b. Inline-edit the material card ────────────────────────── */

  test("edits the material card — autosave persists across reload", async ({
    page,
    db,
  }) => {
    await page.goto(`/inventory/materials/${fullMaterialId}`);
    await expect(page.getByRole("heading", { name: fullMaterialName })).toBeVisible();
    await expect(page.getByLabel("Additional info")).toHaveValue("Fine grain river sand");

    await patchCardField(page, fullMaterialId, "Additional info", "Coarse river sand — updated");

    await page.reload();
    await expect(page.getByLabel("Additional info")).toHaveValue("Coarse river sand — updated");

    const [updated] = await db.select().from(items).where(eq(items.id, fullMaterialId));
    expect(updated.description).toBe("Coarse river sand — updated");
    expect(updated.category).toBe(`Aggregates ${ts}`);
  });

  /* ── 2. Material with only required fields ────────────────────── */

  test("creates a material with only the required name field", async ({ page, db }) => {
    minimalMaterialName = `Gravel ${ts}`;
    minimalMaterialId = await createCardItem(page, "material", minimalMaterialName);

    await page.waitForURL(`**/inventory/materials/${minimalMaterialId}*`);
    await expect(page.getByRole("heading", { name: minimalMaterialName })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: minimalMaterialName })).toBeVisible();

    await page.goto("/inventory/materials");
    await page.getByLabel("Search items").fill(minimalMaterialName);
    const minimalRow = page.getByRole("row", { name: new RegExp(minimalMaterialName) });
    await expect(minimalRow.getByRole("link", { name: minimalMaterialName })).toBeVisible();

    const rows = await db.select().from(items).where(eq(items.name, minimalMaterialName));
    expect(rows).toHaveLength(1);

    const material = rows[0];
    expect(material.itemType).toBe("material");
    expect(material.description).toBeNull();
    expect(material.category).toBeNull();

    const lotRows = await db.select().from(lots).where(eq(lots.itemId, material.id));
    expect(lotRows).toHaveLength(0);
  });

  /* ── 3. Low-stock indicator via API setup ─────────────────────── */

  test("shows low-stock indicator for materials below safety stock", async ({
    page,
    db,
  }) => {
    lowStockMaterialName = `Silt ${ts}`;
    const unitId = getUnitId();
    const created = await createItem({
      itemType: "material",
      name: lowStockMaterialName,
      unitDefinitionId: unitId,
      sku: null,
      category: null,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: null,
      safetyStock: "5",
      stock: "0",
      bom: [],
    });
    if (created.status !== 201) {
      throw new Error(
        `Expected 201 from createItem, got ${created.status}: ${JSON.stringify(created.body)}`,
      );
    }
    lowStockMaterialId = created.body.id;

    const [material] = await db
      .select()
      .from(items)
      .where(eq(items.id, lowStockMaterialId));
    expect(material.safetyStock).toBe("5.0000");

    await page.goto("/inventory/materials");
    await page.getByLabel("Search items").fill(String(ts));
    const firstRow = page
      .getByRole("row", { name: new RegExp(lowStockMaterialName) })
      .first();
    const lowStockIndicator = firstRow.getByLabel("Below safety");
    await expect(lowStockIndicator).toBeVisible();

    await firstRow.getByRole("link", { name: lowStockMaterialName }).click();
    await page.waitForURL(`**/inventory/materials/${lowStockMaterialId}*`);
    await expect(page.getByRole("heading", { name: lowStockMaterialName })).toBeVisible();
  });

  /* ── 4. Product without BOM ───────────────────────────────────── */

  test("creates a product without a BOM via the card UI", async ({ page, db }) => {
    simpleProductName = `Base Mix ${ts}`;
    simpleProductId = await createCardItem(page, "product", simpleProductName);

    await page.waitForURL(`**/inventory/products/${simpleProductId}*`);
    await expect(page.getByRole("heading", { name: simpleProductName })).toBeVisible();

    await patchCardField(page, simpleProductId, "Description", "Simple base product");
    await patchCardField(page, simpleProductId, "Category", `Mixes ${ts}`);

    await page.reload();
    await expect(page.getByLabel("Description")).toHaveValue("Simple base product");
    await expect(page.getByLabel("Category")).toHaveValue(`Mixes ${ts}`);

    await page.goto("/inventory/products");
    await page.getByLabel("Search items").fill(simpleProductName);
    const simpleProductRow = page.getByRole("row", { name: new RegExp(simpleProductName) });
    await expect(simpleProductRow.getByRole("link", { name: simpleProductName })).toBeVisible();
    await expect(simpleProductRow).toContainText(`Mixes ${ts}`);

    const rows = await db.select().from(items).where(eq(items.name, simpleProductName));
    expect(rows).toHaveLength(1);

    const product = rows[0];
    expect(product.itemType).toBe("product");
    expect(product.category).toBe(`Mixes ${ts}`);
    expect(product.description).toBe("Simple base product");

    const bomRows = await db
      .select()
      .from(bomRevisions)
      .where(eq(bomRevisions.productId, product.id));
    expect(bomRows).toHaveLength(0);

    const lotRows = await db.select().from(lots).where(eq(lots.itemId, product.id));
    expect(lotRows).toHaveLength(0);
  });

  /* ── 5. Product with multi-row BOM via Recipe tab ─────────────── */

  test("creates a product with a 3-row BOM via the Recipe tab", async ({
    page,
    db,
  }) => {
    sellableProductName = `Premium Topsoil ${ts}`;
    sellableProductId = await createCardItem(page, "product", sellableProductName);

    await page.waitForURL(`**/inventory/products/${sellableProductId}*`);
    await expect(page.getByRole("heading", { name: sellableProductName })).toBeVisible();

    await patchCardField(
      page,
      sellableProductId,
      "Description",
      "Premium blend using all previous items",
    );
    await patchCardField(page, sellableProductId, "Category", `Blends ${ts}`);

    await page.getByRole("link", { name: /Recipe/ }).click();

    await addBomIngredient(page, fullMaterialName, "4.5");
    await addBomIngredient(page, minimalMaterialName, "3");
    await addBomIngredient(page, simpleProductName, "2");

    const [saveResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith(`/api/items/${sellableProductId}/bom-revisions`),
      ),
      page.getByRole("button", { name: "Save recipe" }).click(),
    ]);
    expect(saveResponse.status()).toBe(201);

    const rows = await db.select().from(items).where(eq(items.name, sellableProductName));
    expect(rows).toHaveLength(1);

    const product = rows[0];
    expect(product.itemType).toBe("product");
    expect(product.category).toBe(`Blends ${ts}`);
    expect(product.description).toBe("Premium blend using all previous items");

    const [currentRevision] = await db
      .select()
      .from(bomRevisions)
      .where(eq(bomRevisions.productId, product.id));

    expect(currentRevision.revisionNumber).toBe(1);
    expect(currentRevision.isCurrent).toBe(true);

    const bom = await db
      .select()
      .from(bomRevisionComponents)
      .where(eq(bomRevisionComponents.bomRevisionId, currentRevision.id));

    expect(bom).toHaveLength(3);

    const bomByComponent = new Map(bom.map((r) => [r.componentId, r.quantity]));
    expect(bomByComponent.get(fullMaterialId)).toBe("4.5000");
    expect(bomByComponent.get(minimalMaterialId)).toBe("3.0000");
    expect(bomByComponent.get(simpleProductId)).toBe("2.0000");
  });

  /* ── 5b. Edit BOM and card-level description ──────────────────── */

  test("edits the BOM product description and BOM quantity via the card UI", async ({
    page,
    db,
  }) => {
    await page.goto(`/inventory/products/${sellableProductId}`);
    await expect(page.getByRole("heading", { name: sellableProductName })).toBeVisible();

    await patchCardField(
      page,
      sellableProductId,
      "Description",
      "Premium blend — updated recipe",
    );

    await page.reload();
    await expect(page.getByLabel("Description")).toHaveValue("Premium blend — updated recipe");

    // Verify BOM rows are pre-populated on Recipe tab
    await page.getByRole("link", { name: /Recipe/ }).click();
    const bomGrid = page.locator('[data-slot="editable-line-data-grid"]').first();
    await expect(
      bomGrid
        .locator(".ag-center-cols-container .ag-row", { hasText: fullMaterialName })
        .first(),
    ).toBeVisible();
    await expect(
      bomGrid
        .locator(".ag-center-cols-container .ag-row", { hasText: minimalMaterialName })
        .first(),
    ).toBeVisible();

    const [updated] = await db.select().from(items).where(eq(items.id, sellableProductId));
    expect(updated.description).toBe("Premium blend — updated recipe");

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

  /* ── 6. API rejection of non-positive BOM quantity ────────────── */

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

    if (invalidCreate.status !== 400) {
      throw new Error(
        `Expected 400 from invalid createItem, got ${invalidCreate.status}: ${JSON.stringify(invalidCreate.body)}`,
      );
    }
    expect(JSON.stringify(invalidCreate.body)).toContain("greater than 0");

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
      defaultSellingPrice: null,
      manufacturingMode: "discrete",
      expectedBatchYield: null,
      safetyStock: "0",
      stock: "0",
      bom: [{ componentId: fullMaterialId, quantity: "-1" }],
    });

    if (invalidUpdate.status !== 400) {
      throw new Error(
        `Expected 400 from invalid updateItem, got ${invalidUpdate.status}: ${JSON.stringify(invalidUpdate.body)}`,
      );
    }
    expect(JSON.stringify(invalidUpdate.body)).toContain("greater than 0");

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
