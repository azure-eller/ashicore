import { test, expect } from "../fixtures";
import { testFetch, getUnitId } from "../../helpers/api";

test.describe("material card: default tab + category combobox", () => {
  const ts = Date.now();
  const existingCategory = `QA Existing ${ts}`;
  const newCategory = `QA New ${ts}`;
  let materialItemId: string;

  test("opens on General info and the category combobox suggests + persists values", async ({
    page,
  }) => {
    // Seed a material that carries a category, so suggestions are non-empty.
    const create = await testFetch("/api/item-cards", {
      method: "POST",
      body: JSON.stringify({
        itemType: "material",
        name: `QA Cat Material ${ts}`,
        category: existingCategory,
        unitDefinitionId: getUnitId(),
      }),
    });
    expect(create.status).toBe(201);
    materialItemId = (await create.json()).itemId as string;

    // New endpoint returns distinct categories for the item type.
    const categories = await testFetch("/api/item-cards/categories?itemType=material");
    expect(categories.status).toBe(200);
    expect(await categories.json()).toContain(existingCategory);
    const rejected = await testFetch("/api/item-cards/categories?itemType=bogus");
    expect(rejected.status).toBe(400);

    // Bug fix: a saved material defaults to the General info tab, not Used in BOMs.
    await page.goto(`/inventory/materials/${materialItemId}`);
    await expect(
      page.getByRole("heading", { name: `QA Cat Material ${ts}`, level: 1 }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[aria-current="page"]')).toHaveText(/General info/);

    // Category is now a combobox prefilled with the saved value.
    const category = page.locator("#card-field-category");
    await expect(category).toHaveValue(existingCategory);

    // The existing category shows up as a selectable suggestion.
    await category.click();
    await expect(
      page.getByRole("option", { name: existingCategory }),
    ).toBeVisible({ timeout: 5_000 });

    // Typing a brand-new value and blurring autosaves it.
    await category.fill(newCategory);
    await category.blur();
    await expect(page.getByText("Saved").first()).toBeVisible({ timeout: 10_000 });

    await expect
      .poll(
        async () => {
          const res = await testFetch(`/api/item-cards/${materialItemId}`);
          return (await res.json()).family.category as string | null;
        },
        { timeout: 10_000 },
      )
      .toBe(newCategory);

    // Survives a reload.
    await page.reload();
    await expect(page.locator("#card-field-category")).toHaveValue(newCategory);
  });
});
