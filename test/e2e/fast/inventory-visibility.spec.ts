import { eq } from "drizzle-orm";
import type { Page } from "@playwright/test";
import { test, expect, filterList } from "../fixtures";
import { items } from "../../../lib/db/schema";
import { createItem, getUnitId, testFetch } from "../../helpers/api";

test.describe.configure({ mode: "serial" });

test.describe("inventory visibility", () => {
  const ts = Date.now();
  const unitDefinitionId = getUnitId();

  const sellableOnlyName = `Visibility Sellable ${ts}`;
  const internalOnlyName = `Visibility Internal ${ts}`;
  const sharedComponentName = `Visibility Shared Component ${ts}`;
  const parentProductName = `Visibility Parent Product ${ts}`;
  const mixedMasterName = `Visibility Family ${ts}`;
  const mixedSellableVariantValue = "Retail Bag";
  const mixedInternalVariantValue = "1 Yard Tote";
  const mixedSellableVariantDisplay = `${mixedMasterName} / ${mixedSellableVariantValue}`;
  const mixedInternalVariantDisplay = `${mixedMasterName} / ${mixedInternalVariantValue}`;

  let sellableOnlyId = "";
  let internalOnlyId = "";
  let sharedComponentId = "";
  let parentProductId = "";
  let mixedInternalVariantId = "";

  const visibleProductLink = (page: Page, name: string) =>
    page
      .locator('[data-slot="erp-data-grid"] .ag-center-cols-container')
      .getByRole("link", { name })
      .first();

  test("creates the visibility matrix fixtures", async ({ db }) => {
    const sellableOnly = await createItem({
      name: sellableOnlyName,
      itemType: "product",
      unitDefinitionId,
      sellable: true,
      stock: "0",
      safetyStock: "0",
      manufacturingMode: "discrete",
      purchaseUnitDefinitionId: null,
      purchaseToStockFactor: null,
      sku: null,
      category: `Visibility ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "22.00",
      expectedBatchYield: null,
      bom: [],
      revisionNote: null,
    });
    expect(sellableOnly.status).toBe(201);
    sellableOnlyId = sellableOnly.body.id;

    const internalOnly = await createItem({
      name: internalOnlyName,
      itemType: "product",
      unitDefinitionId,
      sellable: false,
      stock: "0",
      safetyStock: "0",
      manufacturingMode: "discrete",
      purchaseUnitDefinitionId: null,
      purchaseToStockFactor: null,
      sku: null,
      category: `Visibility ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: null,
      expectedBatchYield: null,
      bom: [],
      revisionNote: null,
    });
    expect(internalOnly.status).toBe(201);
    internalOnlyId = internalOnly.body.id;

    const sharedComponent = await createItem({
      name: sharedComponentName,
      itemType: "product",
      unitDefinitionId,
      sellable: true,
      stock: "0",
      safetyStock: "0",
      manufacturingMode: "discrete",
      purchaseUnitDefinitionId: null,
      purchaseToStockFactor: null,
      sku: null,
      category: `Visibility ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "18.00",
      expectedBatchYield: null,
      bom: [],
      revisionNote: null,
    });
    expect(sharedComponent.status).toBe(201);
    sharedComponentId = sharedComponent.body.id;

    const parentProduct = await createItem({
      name: parentProductName,
      itemType: "product",
      unitDefinitionId,
      sellable: true,
      stock: "0",
      safetyStock: "0",
      manufacturingMode: "discrete",
      purchaseUnitDefinitionId: null,
      purchaseToStockFactor: null,
      sku: null,
      category: `Visibility ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "45.00",
      expectedBatchYield: null,
      bom: [{ componentId: sharedComponent.body.id, quantity: "1" }],
      revisionNote: "Initial parent product recipe",
    });
    expect(parentProduct.status).toBe(201);
    parentProductId = parentProduct.body.id;

    const mixedCard = await testFetch("/api/item-cards", {
      method: "POST",
      body: JSON.stringify({
        itemType: "product",
        name: mixedMasterName,
        description: null,
        category: `Visibility ${ts}`,
        unitDefinitionId,
        sellable: true,
        defaultSellingPrice: "32.00",
      }),
    });
    expect(mixedCard.status).toBe(201);
    const mixedCardBody = await mixedCard.json();
    const mixedDefaultVariantId = mixedCardBody.itemId as string;

    const mixedConfig = await testFetch(
      `/api/item-cards/${mixedDefaultVariantId}/variant-config`,
      {
        method: "PUT",
        body: JSON.stringify({
          options: [
            {
              name: "Package",
              values: [
                { label: mixedSellableVariantValue },
                { label: mixedInternalVariantValue },
              ],
            },
          ],
        }),
      },
    );
    expect(mixedConfig.status).toBe(200);

    const mixedGenerate = await testFetch(
      `/api/item-cards/${mixedDefaultVariantId}/variants/generate`,
      { method: "POST", body: JSON.stringify({}) },
    );
    expect(mixedGenerate.status).toBe(201);

    const mixedCardRead = await testFetch(`/api/item-cards/${mixedDefaultVariantId}`);
    expect(mixedCardRead.status).toBe(200);
    const mixedCardReadBody = await mixedCardRead.json();
    const mixedInternalVariant = mixedCardReadBody.variants.find(
      (variant: { optionValues: Array<{ valueLabel: string }> }) =>
        variant.optionValues.some((value) => value.valueLabel === mixedInternalVariantValue),
    );
    expect(mixedInternalVariant).toBeTruthy();
    mixedInternalVariantId = mixedInternalVariant.id;

    await db
      .update(items)
      .set({ sellable: false })
      .where(eq(items.id, mixedInternalVariantId));

    const [sellableOnlyRow, internalOnlyRow, sharedComponentRow, parentProductRow, mixedInternalRow] =
      await Promise.all([
        db.select().from(items).where(eq(items.id, sellableOnlyId)).then((rows) => rows[0]),
        db.select().from(items).where(eq(items.id, internalOnlyId)).then((rows) => rows[0]),
        db.select().from(items).where(eq(items.id, sharedComponentId)).then((rows) => rows[0]),
        db.select().from(items).where(eq(items.id, parentProductId)).then((rows) => rows[0]),
        db.select().from(items).where(eq(items.id, mixedInternalVariantId)).then((rows) => rows[0]),
      ]);

    expect(sellableOnlyRow?.sellable).toBe(true);
    expect(internalOnlyRow?.sellable).toBe(false);
    expect(sharedComponentRow?.sellable).toBe(true);
    expect(parentProductRow?.sellable).toBe(true);
    expect(mixedInternalRow?.sellable).toBe(false);
  });

  test("shows sellable and internal made rows in Products", async ({ page }) => {
    await page.goto("/inventory/products");
    await expect(page.getByRole("link", { name: "New Product" })).toBeVisible();

    await filterList(page, "Search items", sellableOnlyName);
    await expect(visibleProductLink(page, sellableOnlyName)).toBeVisible();

    await filterList(page, "Search items", internalOnlyName);
    const internalOnlyRow = page.getByRole("row", { name: new RegExp(internalOnlyName) });
    await expect(visibleProductLink(page, internalOnlyName)).toBeVisible();
    await expect(internalOnlyRow.getByText("Not sellable").first()).toBeVisible();

    await filterList(page, "Search items", sharedComponentName);
    await expect(visibleProductLink(page, sharedComponentName)).toBeVisible();

    await filterList(page, "Search items", mixedMasterName);
    await expect(visibleProductLink(page, mixedSellableVariantDisplay)).toBeVisible();
    await expect(visibleProductLink(page, mixedInternalVariantDisplay)).toBeVisible();
    await expect(page.getByRole("button", { name: /^(Expand|Collapse)$/ })).toHaveCount(0);
    await expect(page.getByText(/\d+ variants?/)).toHaveCount(0);
  });

  test("toggling sellable marks a product internal but keeps it in Products", async ({ page, db }) => {
    // The card UI does not yet expose a sellable checkbox. Toggle via the
    // legacy PUT /api/items endpoint, then verify the product list reflects
    // the new state.
    const toggleResponse = await testFetch(`/api/items/${sellableOnlyId}`, {
      method: "PUT",
      body: JSON.stringify({
        name: sellableOnlyName,
        sku: null,
        category: `Visibility ${ts}`,
        description: null,
        defaultPurchasePrice: null,
        defaultSellingPrice: "22.00",
        sellable: false,
        manufacturingMode: "discrete",
        expectedBatchYield: null,
        safetyStock: "0",
        stock: "0",
        bom: [],
      }),
    });
    expect(toggleResponse.status).toBe(200);

    await expect
      .poll(async () => {
        const [updated] = await db.select().from(items).where(eq(items.id, sellableOnlyId));
        return updated?.sellable;
      })
      .toBe(false);

    await page.goto("/inventory/products");
    await filterList(page, "Search items", sellableOnlyName);
    const movedRow = page.getByRole("row", { name: new RegExp(sellableOnlyName) });
    await expect(visibleProductLink(page, sellableOnlyName)).toBeVisible();
    await expect(movedRow.getByText("Not sellable").first()).toBeVisible();
  });

  test("soft-deleting the only parent clears used-in counts", async ({ db }) => {
    const deleteResponse = await testFetch(`/api/item-cards/${parentProductId}`, {
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(200);

    const [deletedParent] = await db.select().from(items).where(eq(items.id, parentProductId));
    expect(deletedParent == null || deletedParent.deletedAt != null).toBe(true);

    // The product card doesn't expose a "used in BOMs" surface on products;
    // verify via the API that the soft-deleted parent no longer reports the
    // shared component as a current dependency.
    const usedInResponse = await testFetch(`/api/items/${sharedComponentId}/used-in`);
    expect(usedInResponse.status).toBe(200);
    const usedInBody = await usedInResponse.json();
    const parentIds = (usedInBody?.parents ?? []).map((row: { id: string }) => row.id);
    expect(parentIds).not.toContain(parentProductId);
  });
});
