import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";
import { testFetch, getUnitId } from "../../helpers/api";
import { asc, eq, isNull, and } from "drizzle-orm";
import { items, variantOptions } from "@/lib/db/schema";

test.describe.configure({ mode: "serial" });

test.describe("variant-first item card", () => {
  const ts = Date.now();
  const productName = `Card Soil ${ts}`;
  let productItemId: string;

  async function openVariantConfiguration(page: Page) {
    await page.goto(`/inventory/products/${productItemId}`);

    const openButton = page.getByRole("button", { name: "Open configuration…" });
    if (await openButton.isVisible().catch(() => false)) {
      await openButton.click();
    } else {
      await page.getByLabel("This product has multiple variants").click();
    }

    await expect(
      page.getByRole("heading", { name: "Product variant configuration" }),
    ).toBeVisible({ timeout: 15_000 });
  }

  test("creating a card from POST /api/item-cards renders the route-tab card", async ({
    page,
  }) => {
    const response = await testFetch("/api/item-cards", {
      method: "POST",
      body: JSON.stringify({
        itemType: "product",
        name: productName,
        unitDefinitionId: getUnitId(),
        sellable: false,
      }),
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.itemId).toBeTruthy();
    productItemId = body.itemId;

    await page.goto(`/inventory/products/${productItemId}`);
    await expect(
      page.getByRole("heading", { name: productName, level: 1 }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Saved").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "General info" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Recipe" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Production" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Lots" })).toBeVisible();

    await page.goto(`/inventory/products/${productItemId}?tab=operations`);
    await expect(page).toHaveURL(new RegExp(`/inventory/products/${productItemId}/production$`));
    await expect(page.getByRole("heading", { name: "Production" })).toBeVisible();
  });

  test("opens the variant configuration dialog from General info", async ({ page }) => {
    await openVariantConfiguration(page);
    await expect(page.getByRole("button", { name: "Add option" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(
      page.getByRole("heading", { name: "Product variant configuration" }),
    ).not.toBeVisible();
  });

  test("deleting all variant axes brings back the variant checkbox", async ({
    page,
    db,
  }) => {
    const configResponse = await testFetch(
      `/api/item-cards/${productItemId}/variant-config`,
      {
        method: "PUT",
        body: JSON.stringify({
          options: [
            {
              name: "Temporary package",
              values: [{ label: "single" }],
            },
          ],
        }),
      },
    );
    expect(configResponse.status).toBe(200);

    await page.goto(`/inventory/products/${productItemId}`);
    await expect(page.getByLabel("This product has multiple variants")).not.toBeVisible();
    await page.getByRole("button", { name: "Open configuration…" }).click();
    const dialog = page.getByRole("dialog", {
      name: "Product variant configuration",
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Remove option" }).click();

    const [response] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.request().method() === "PUT" &&
          res.url().endsWith(`/api/item-cards/${productItemId}/variant-config`),
      ),
      dialog.getByRole("button", { name: "Save" }).click(),
    ]);

    expect(response.status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: "Product variant configuration" }),
    ).not.toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("This product has multiple variants")).toBeVisible();

    const [seed] = await db
      .select({ familyId: items.familyId })
      .from(items)
      .where(eq(items.id, productItemId));
    expect(seed?.familyId).toBeTruthy();

    const activeOptions = await db
      .select({ id: variantOptions.id })
      .from(variantOptions)
      .where(
        and(
          eq(variantOptions.familyId, seed!.familyId!),
          isNull(variantOptions.disabledAt),
        ),
      );
    expect(activeOptions).toHaveLength(0);
  });

  test("configures options + generates variants via the dialog", async ({ page, db }) => {
    await openVariantConfiguration(page);
    const dialog = page.getByRole("dialog", {
      name: "Product variant configuration",
    });

    await page.getByRole("button", { name: "Add option" }).click();
    const optionInputs = dialog.getByRole("textbox");
    await expect(optionInputs.first()).toBeVisible({ timeout: 15_000 });
    await optionInputs.first().fill("Package");

    const valueInput = optionInputs.nth(1);
    await valueInput.fill("1cf bag");
    await valueInput.press("Enter");
    await valueInput.fill("2cf bag");
    await valueInput.press("Enter");

    await page
      .getByRole("button", { name: "Generate product variants" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Product variant configuration" }),
    ).not.toBeVisible({ timeout: 15_000 });

    await expect(page.getByRole("columnheader", { name: "Package" })).toBeVisible();
    await expect(page.getByText("1cf bag").first()).toBeVisible();
    await expect(page.getByText("2cf bag").first()).toBeVisible();

    const [seed] = await db
      .select({ familyId: items.familyId })
      .from(items)
      .where(eq(items.id, productItemId));
    expect(seed?.familyId).toBeTruthy();

    const rows = await db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.familyId, seed!.familyId!), isNull(items.deletedAt)));
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  test("inline variant edits autosave through the item card engine", async ({
    page,
    db,
  }) => {
    const [seed] = await db
      .select({ familyId: items.familyId })
      .from(items)
      .where(eq(items.id, productItemId));
    expect(seed?.familyId).toBeTruthy();

    const [variant] = await db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.familyId, seed!.familyId!), isNull(items.deletedAt)))
      .orderBy(asc(items.sortOrder));
    expect(variant?.id).toBeTruthy();

    await page.goto(`/inventory/products/${productItemId}`);
    const grid = page.locator('[data-slot="editable-line-data-grid"]').first();
    await expect(grid).toBeVisible();
    const row = grid.locator(".ag-center-cols-container .ag-row").first();
    const skuCell = row.locator('[col-id="sku"]').first();
    await skuCell.click();
    const editor = skuCell.locator("input").first();
    await expect(editor).toBeVisible();

    const nextSku = `CARD-SKU-${ts}`;
    const [response] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.request().method() === "PATCH" &&
          res.url().endsWith(`/api/item-cards/${variant.id}/variant`),
      ),
      editor.fill(nextSku).then(() => editor.press("Enter")),
    ]);

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.family.name).toBe(productName);
    expect(
      body.variants.some(
        (row: { id: string; sku: string | null }) =>
          row.id === variant.id && row.sku === nextSku,
      ),
    ).toBe(true);

    const [updated] = await db
      .select({ sku: items.sku })
      .from(items)
      .where(eq(items.id, variant.id));
    expect(updated.sku).toBe(nextSku);
  });

  test("product family fields autosave through the item card engine", async ({
    page,
    db,
  }) => {
    await page.goto(`/inventory/products/${productItemId}`);
    const nextName = `Card Soil Renamed ${ts}`;
    const nameInput = page.getByLabel("Product name");
    await expect(nameInput).toBeVisible();

    const [response] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.request().method() === "PATCH" &&
          res.url().endsWith(`/api/item-cards/${productItemId}`),
      ),
      nameInput.fill(nextName).then(() => nameInput.blur()),
    ]);

    expect(response.status()).toBe(200);
    await expect(page.getByRole("heading", { name: nextName, level: 1 })).toBeVisible();

    const [updated] = await db
      .select({ name: items.name })
      .from(items)
      .where(eq(items.id, productItemId));
    expect(updated.name).toBe(nextName);
  });

  test("sellable toggle autosaves through the item card engine", async ({
    page,
    db,
  }) => {
    const [seed] = await db
      .select({ familyId: items.familyId })
      .from(items)
      .where(eq(items.id, productItemId));
    expect(seed?.familyId).toBeTruthy();

    await page.goto(`/inventory/products/${productItemId}`);
    const sellable = page.getByLabel("Sellable");
    await expect(sellable).toBeVisible();

    const [response] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.request().method() === "POST" &&
          res.url().endsWith(`/api/item-cards/${productItemId}/sellable`),
      ),
      sellable.check(),
    ]);

    expect(response.status()).toBe(200);
    const variants = await db
      .select({ sellable: items.sellable })
      .from(items)
      .where(and(eq(items.familyId, seed!.familyId!), isNull(items.deletedAt)));
    expect(variants.length).toBeGreaterThan(0);
    expect(variants.every((row) => row.sellable)).toBe(true);
  });

  test("barcode generation waits for engine flush", async ({ page, db }) => {
    const [seed] = await db
      .select({ familyId: items.familyId })
      .from(items)
      .where(eq(items.id, productItemId));
    expect(seed?.familyId).toBeTruthy();

    await page.goto(`/inventory/products/${productItemId}`);
    const button = page.getByRole("button", { name: "Generate internal barcodes" });
    await expect(button).toBeVisible();

    const [response] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.request().method() === "PATCH" &&
          res.url().includes("/api/item-cards/") &&
          res.url().endsWith("/variant"),
      ),
      button.click(),
    ]);

    expect(response.status()).toBe(200);
    await expect(
      page.getByRole("button", { name: "Internal barcodes assigned" }),
    ).toBeVisible({ timeout: 15_000 });

    const variants = await db
      .select({ internalBarcode: items.internalBarcode })
      .from(items)
      .where(and(eq(items.familyId, seed!.familyId!), isNull(items.deletedAt)));
    expect(variants.length).toBeGreaterThan(0);
    expect(variants.every((row) => row.internalBarcode != null)).toBe(true);
  });
});
