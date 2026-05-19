import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";
import { testFetch, getUnitId } from "../../helpers/api";
import { eq, isNull, and } from "drizzle-orm";
import { items } from "@/lib/db/schema";

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
    await expect(page.getByText("All changes saved").first()).toBeVisible();
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
});
