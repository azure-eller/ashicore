import { test, expect } from "../fixtures";
import { testFetch, getUnitId } from "../../helpers/api";
import { eq, isNull, and } from "drizzle-orm";
import { items } from "@/lib/db/schema";

test.describe.configure({ mode: "serial" });

test.describe("variant-first item card", () => {
  const ts = Date.now();
  const productName = `Card Soil ${ts}`;
  let productItemId: string;

  test("creating a card from POST /api/item-cards lands on /products/:id?view=card", async ({
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
    expect(body.id).toBeTruthy();
    productItemId = body.id;

    await page.goto(`/inventory/products/${productItemId}?view=card`);
    await expect(
      page.getByRole("heading", { name: productName, level: 1 }),
    ).toBeVisible({ timeout: 15_000 });
    // Card header save-status indicator
    await expect(page.getByText("All changes saved").first()).toBeVisible();
    // Tab nav
    await expect(page.getByRole("button", { name: "General info" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Product recipe / BOM" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Production operations" }),
    ).toBeVisible();
  });

  test("opens the variant configuration dialog from General info", async ({ page }) => {
    await page.goto(`/inventory/products/${productItemId}?view=card`);
    await page.getByRole("button", { name: "Open configuration…" }).click();
    await expect(
      page.getByRole("heading", { name: "Product variant configuration" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Add option" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(
      page.getByRole("heading", { name: "Product variant configuration" }),
    ).not.toBeVisible();
  });

  test("configures options + generates variants via the dialog", async ({ page, db }) => {
    await page.goto(`/inventory/products/${productItemId}?view=card`);
    await page.getByRole("button", { name: "Open configuration…" }).click();

    await page.getByRole("button", { name: "Add option" }).click();
    await page.getByPlaceholder("e.g. Package, Size, Blend").fill("Package");

    const valueInput = page.getByPlaceholder("e.g. 1cf bag, 2cf bag");
    await valueInput.fill("1cf bag");
    await valueInput.press("Enter");
    await valueInput.fill("2cf bag");
    await valueInput.press("Enter");

    await page.getByRole("button", { name: "Save configuration" }).click();
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
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });
});
