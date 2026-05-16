import { eq } from "drizzle-orm";
import type { Page } from "@playwright/test";
import { test, expect, filterList } from "../fixtures";
import { items } from "../../../lib/db/schema";
import { createItem, createVariant, deleteItem, getUnitId } from "../../helpers/api";

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

    const mixedMaster = await createItem({
      isMaster: true,
      name: mixedMasterName,
      description: null,
      category: `Visibility ${ts}`,
      variantAxes: ["Package"],
    });
    expect(mixedMaster.status).toBe(201);

    const mixedSellableVariant = await createVariant(mixedMaster.body.id, {
      unitDefinitionId,
      variantAttrs: { Package: mixedSellableVariantValue },
      sellable: true,
      sku: null,
      description: null,
      defaultSellingPrice: "32.00",
      defaultPurchasePrice: null,
      safetyStock: "0",
      manufacturingMode: "discrete",
      expectedBatchYield: null,
      bom: [],
      revisionNote: null,
    });
    expect(mixedSellableVariant.status).toBe(201);

    const mixedInternalVariant = await createVariant(mixedMaster.body.id, {
      unitDefinitionId,
      variantAttrs: { Package: mixedInternalVariantValue },
      sellable: false,
      sku: null,
      description: null,
      defaultSellingPrice: null,
      defaultPurchasePrice: null,
      safetyStock: "0",
      manufacturingMode: "discrete",
      expectedBatchYield: null,
      bom: [],
      revisionNote: null,
    });
    expect(mixedInternalVariant.status).toBe(201);
    mixedInternalVariantId = mixedInternalVariant.body.id;

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
    await expect(internalOnlyRow.getByText("Not sellable")).toBeVisible();

    await filterList(page, "Search items", sharedComponentName);
    await expect(visibleProductLink(page, sharedComponentName)).toBeVisible();

    await filterList(page, "Search items", mixedMasterName);
    await expect(visibleProductLink(page, mixedSellableVariantDisplay)).toBeVisible();
    await expect(visibleProductLink(page, mixedInternalVariantDisplay)).toBeVisible();
    await expect(page.getByRole("button", { name: /^(Expand|Collapse)$/ })).toHaveCount(0);
    await expect(page.getByText(/\d+ variants?/)).toHaveCount(0);
  });

  test("redirects old Sub-assemblies route to Products", async ({ page }) => {
    await page.goto("/inventory/sub-assemblies");
    await page.waitForURL("**/inventory/products");
    await expect(page.getByLabel("Search items")).toBeVisible();
  });

  test("toggling sellable marks a product internal but keeps it in Products", async ({ page, db }) => {
    await page.goto(`/inventory/products/${sellableOnlyId}/edit`);
    await expect(page.getByRole("heading", { name: "Edit Product" })).toBeVisible();

    const sellableCheckbox = page.getByRole("checkbox", { name: "Sellable" });
    await expect(sellableCheckbox).toBeChecked();
    await sellableCheckbox.click();
    await expect(sellableCheckbox).not.toBeChecked();

    const updateResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        response.url().endsWith(`/api/items/${sellableOnlyId}`),
    );
    await page.getByRole("button", { name: "Save Changes" }).click();
    expect((await updateResponsePromise).status()).toBe(200);
    await page.waitForURL(new RegExp(`/inventory/products/${sellableOnlyId}$`));
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
    await expect(movedRow.getByText("Not sellable")).toBeVisible();
  });

  test("soft-deleting the only parent clears used-in counts", async ({
    page,
    db,
  }) => {
    const deleteResponse = await deleteItem(parentProductId);
    expect(deleteResponse.status).toBe(200);

    const [deletedParent] = await db.select().from(items).where(eq(items.id, parentProductId));
    expect(deletedParent.deletedAt).toBeTruthy();

    await page.goto(`/inventory/products/${sharedComponentId}`);
    await expect(page.getByRole("heading", { name: sharedComponentName })).toBeVisible();
    await expect(page.getByText("Not used in any current product recipes.")).toBeVisible();
    await expect(page.getByRole("link", { name: parentProductName })).toHaveCount(0);
  });
});
