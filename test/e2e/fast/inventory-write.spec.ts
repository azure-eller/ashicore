import { eq } from "drizzle-orm";
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import {
  bomRevisionComponentAlternates,
  bomRevisionComponentConstraints,
  bomRevisionComponents,
  bomRevisions,
  inventoryEvents,
  items,
  lots,
} from "../../../lib/db/schema";
import { todayInTimeZone } from "../../../lib/format";
import { createItem, getUnitId, testFetch } from "../../helpers/api";

test.describe("Inventory write-path smoke (card UI)", () => {
  test.describe.configure({ mode: "serial" });

  const ts = Date.now();
  const unitId = getUnitId();
  let materialId = "";
  let materialLotId = "";
  let materialName = "";
  let alternateMaterialId = "";
  let alternateMaterialName = "";
  let productId = "";
  let productName = "";

  async function fillBomQuantity(page: Page, componentName: string, quantity: string) {
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

  async function setBomMinimumLotAge(
    page: Page,
    componentName: string,
    days: string
  ) {
    const materialsGrid = page.locator('[data-slot="editable-line-data-grid"]').first();
    const row = materialsGrid
      .locator(".ag-center-cols-container .ag-row", { hasText: componentName })
      .first();
    await expect(row).toBeVisible();

    await row.locator('[col-id="minimumLotAgeDays"]').getByRole("button").click();
    await page.getByLabel("Require aged lots").click();
    await page.getByLabel("Minimum age").fill(days);
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(row.locator('[col-id="minimumLotAgeDays"]')).toContainText(
      `Age ≥ ${days}d`
    );
  }

  async function addBomAlternate(
    page: Page,
    componentName: string,
    alternateName: string
  ) {
    const materialsGrid = page.locator('[data-slot="editable-line-data-grid"]').first();
    const row = materialsGrid
      .locator(".ag-center-cols-container .ag-row", { hasText: componentName })
      .first();
    await expect(row).toBeVisible();

    await row.locator('[col-id="alternates"]').getByRole("button").click();
    await page.getByPlaceholder("Add alternate...").fill(alternateName);
    await page.getByRole("option", { name: alternateName }).click();
    await expect(row.locator('[col-id="alternates"]')).toContainText("1 alt");
  }

  test("creates and edits a material through the card UI", async ({ page, db }) => {
    materialName = `Fast Inventory Sand ${ts}`;

    await page.goto("/inventory/material");
    const nameInput = page.getByLabel("Material name");
    await expect(nameInput).toBeVisible();
    await nameInput.fill(materialName);

    const [createResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/api/item-cards"),
      ),
      nameInput.blur(),
    ]);
    expect(createResponse.status()).toBe(201);
    const createBody = await createResponse.json();
    materialId = createBody.itemId;

    await page.waitForURL(`**/inventory/materials/${materialId}*`);
    await expect(page.getByRole("heading", { name: materialName })).toBeVisible();

    const [material] = await db.select().from(items).where(eq(items.id, materialId));
    expect(material.itemType).toBe("material");
    expect(material.name).toBe(materialName);

    // Inline-edit the description on the saved card — autosaves on blur.
    await page.getByRole("button", { name: "General info" }).click();
    const descTextarea = page.getByLabel("Additional info");
    await descTextarea.click();
    await descTextarea.clear();
    await descTextarea.fill("Fast smoke material");
    const [descResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          response.url().includes(`/api/item-cards/${materialId}`),
      ),
      descTextarea.blur(),
    ]);
    expect(descResponse.status()).toBe(200);

    const [updated] = await db.select().from(items).where(eq(items.id, materialId));
    expect(updated.description).toBe("Fast smoke material");

    alternateMaterialName = `Fast Inventory Sand Alt ${ts}`;
    const alternate = await createItem({
      itemType: "material",
      name: alternateMaterialName,
      unitDefinitionId: unitId,
      sku: null,
      category: null,
      description: "Alternate material for BOM authoring",
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(alternate.status).toBe(201);
    alternateMaterialId = alternate.body.id as string;
  });

  test("adjusts an existing lot quantity through the API", async ({ db }) => {
    // The card UI's Add Initial Stock endpoint is not yet shipped, so create a
    // separate material with stock via the legacy POST /api/items endpoint to
    // exercise the lot quantity adjust API.
    const lotMaterialName = `Fast Inventory Lot ${ts}`;
    const created = await createItem({
      itemType: "material",
      name: lotMaterialName,
      unitDefinitionId: unitId,
      sku: null,
      category: null,
      description: null,
      defaultPurchasePrice: "3.50",
      defaultSellingPrice: null,
      stock: "200",
      safetyStock: "0",
      bom: [],
    });
    if (created.status !== 201) {
      throw new Error(
        `Expected 201 from createItem, got ${created.status}: ${JSON.stringify(created.body)}`,
      );
    }
    const lotMaterialId = created.body.id;

    const [lot] = await db.select().from(lots).where(eq(lots.itemId, lotMaterialId));
    expect(lot).toBeDefined();
    materialLotId = lot.id;
    expect(lot.quantity).toBe("200.0000");
    expect(lot.lotNumber).toBe(`LOT-${todayInTimeZone("America/Denver")}`);

    const response = await testFetch(
      `/api/items/${lotMaterialId}/lots/${materialLotId}/quantity`,
      {
        method: "PUT",
        body: JSON.stringify({ quantity: "205", note: null }),
      },
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ lotId: materialLotId, quantity: "205" });

    const [updatedLot] = await db
      .select({ quantity: lots.quantity })
      .from(lots)
      .where(eq(lots.id, materialLotId));
    expect(updatedLot.quantity).toBe("205.0000");

    const adjustmentEvents = await db
      .select({
        eventType: inventoryEvents.eventType,
        quantity: inventoryEvents.quantity,
        lotId: inventoryEvents.lotId,
      })
      .from(inventoryEvents)
      .where(eq(inventoryEvents.lotId, materialLotId));
    expect(adjustmentEvents).toContainEqual({
      eventType: "manual_adjustment_increase",
      quantity: "5.0000",
      lotId: materialLotId,
    });
  });

  test("creates a BOM-backed product through the card UI", async ({ page, db }) => {
    productName = `Fast Blend ${ts}`;

    await page.goto("/inventory/product");
    const nameInput = page.getByLabel("Product name");
    await expect(nameInput).toBeVisible();
    await nameInput.fill(productName);

    const [createResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/api/item-cards"),
      ),
      nameInput.blur(),
    ]);
    expect(createResponse.status()).toBe(201);
    const createBody = await createResponse.json();
    productId = createBody.itemId;

    await page.waitForURL(`**/inventory/products/${productId}*`);
    await expect(page.getByRole("heading", { name: productName })).toBeVisible();

    await page.getByRole("link", { name: "Recipe" }).click();
    await page.waitForURL(`**/inventory/products/${productId}/recipe`);
    await page.getByRole("button", { name: "Add ingredient" }).click();
    const componentInput = page.getByPlaceholder("Search items...").first();
    await expect(componentInput).toBeVisible();
    await componentInput.click();
    await componentInput.fill(materialName);
    await page.getByRole("option", { name: materialName }).click();
    await fillBomQuantity(page, materialName, "1.25");
    await setBomMinimumLotAge(page, materialName, "14");
    await addBomAlternate(page, materialName, alternateMaterialName);

    const [saveResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith(`/api/items/${productId}/bom-revisions`),
      ),
      page.getByRole("button", { name: "Save recipe" }).click(),
    ]);
    expect(saveResponse.status()).toBe(201);

    const [product] = await db.select().from(items).where(eq(items.id, productId));
    expect(product.itemType).toBe("product");
    expect(product.name).toBe(productName);

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

    const requirementRows = await db
      .select()
      .from(bomRevisionComponentConstraints)
      .where(eq(bomRevisionComponentConstraints.bomRevisionComponentId, productBom[0].id));
    expect(requirementRows).toHaveLength(1);
    expect(requirementRows[0]).toMatchObject({
      constraintType: "lot_age_min_days",
      config: { days: 14, basis: "received_at" },
    });

    const alternateRows = await db
      .select()
      .from(bomRevisionComponentAlternates)
      .where(eq(bomRevisionComponentAlternates.bomRevisionComponentId, productBom[0].id));
    expect(alternateRows).toHaveLength(1);
    expect(alternateRows[0]).toMatchObject({
      alternateItemId: alternateMaterialId,
      alternateItemName: alternateMaterialName,
    });
  });

  test("editing BOM quantity creates a new BOM revision", async ({ page, db }) => {
    await page.goto(`/inventory/products/${productId}/recipe`);
    await fillBomQuantity(page, materialName, "1.5");

    const [saveResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith(`/api/items/${productId}/bom-revisions`),
      ),
      page.getByRole("button", { name: "Save recipe" }).click(),
    ]);
    expect(saveResponse.status()).toBe(201);

    const revisions = await db
      .select()
      .from(bomRevisions)
      .where(eq(bomRevisions.productId, productId));
    expect(revisions).toHaveLength(2);

    const currentRevision = revisions.find((revision) => revision.isCurrent);
    expect(currentRevision?.revisionNumber).toBe(2);

    const currentBom = await db
      .select()
      .from(bomRevisionComponents)
      .where(eq(bomRevisionComponents.bomRevisionId, currentRevision!.id));
    expect(currentBom).toHaveLength(1);
    expect(currentBom[0].quantity).toBe("1.5000");
  });
});
