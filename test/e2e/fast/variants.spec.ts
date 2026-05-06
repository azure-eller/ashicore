import { filterList, test, expect } from "../fixtures";
import { and, eq, isNull } from "drizzle-orm";
import { items } from "@/lib/db/schema";

test.describe.configure({ mode: "serial" });

test.describe("variant master products", () => {
  const ts = Date.now();
  const masterName = `Test Soil ${ts}`;
  let masterId: string;
  let variantId: string;
  const packageValue = "2 Cubic Foot Bag";
  const variantDisplayName = `${masterName} / ${packageValue}`;

  test("create master product with variant axis", async ({ page, db }) => {
    await page.goto("/inventory/products/new");

    // Fill basic fields
    await page.getByLabel("Name").fill(masterName);

    const variantsToggle = page.getByRole("switch", { name: "Variant master" });
    await variantsToggle.click();

    // Wait for the Variant Axes section to appear
    await expect(page.getByText("Variant Axes")).toBeVisible();

    // Add an axis using the AxesInput component
    const axisInput = page.getByPlaceholder("e.g. Package");
    await axisInput.fill("Package");
    await axisInput.press("Enter");

    // The axis tag should appear
    await expect(page.getByText("Package").first()).toBeVisible();

    await page.getByRole("button", { name: "Create Variant Master" }).click();

    // Should land on the master detail page
    await page.waitForURL(/\/inventory\/products\/[0-9a-f-]+/, { timeout: 15_000 });

    // Capture the masterId from URL
    const url = page.url();
    masterId = url.split("/").at(-1)!;

    // Verify DB
    const master = await db
      .select()
      .from(items)
      .where(and(eq(items.name, masterName), eq(items.isMaster, true), isNull(items.deletedAt)))
      .then((r: typeof items.$inferSelect[]) => r[0]);

    expect(master).toBeTruthy();
    expect(master!.variantAxes).toEqual(["Package"]);
    expect(master!.sku).toBeNull();
    expect(master!.unitDefinitionId).toBeNull();
  });

  test("add variant to master product", async ({ page, db }) => {
    await page.goto(`/inventory/products/${masterId}/variants/new`);

    // Wait for form to load
    await expect(page.getByText("Add Variant")).toBeVisible({ timeout: 15_000 });

    // Fill Package axis value — field label is the axis name "Package"
    await page.getByLabel("Package").fill(packageValue);
    await expect(page.getByLabel("Variant Title")).toHaveValue(variantDisplayName);

    // Select stocking unit — the select trigger has id="unitDefinitionId"
    await page.locator("#unitDefinitionId").click();
    const firstOption = page.getByRole("option").first();
    await firstOption.waitFor({ state: "visible", timeout: 5_000 });
    await firstOption.click();

    // Fill selling price
    await page.getByLabel("Selling Price").fill("30.00");

    // Submit
    await page.getByRole("button", { name: "Create Variant" }).click();

    // Should redirect back to master detail
    await page.waitForURL(new RegExp(`/inventory/products/${masterId}$`), { timeout: 15_000 });
    await page.goto("/inventory/products");
    await filterList(page, "Search items", masterName);
    await expect(page.getByRole("link", { name: masterName }).first()).toBeVisible();

    // Verify DB
    const variant = await db
      .select()
      .from(items)
      .where(and(eq(items.parentId, masterId), isNull(items.deletedAt)))
      .then((r: typeof items.$inferSelect[]) => r[0]);

    expect(variant).toBeTruthy();
    variantId = variant!.id;
    expect(variant!.name).toBe(masterName); // variant name = master name
    expect(variant!.variantAttrs).toEqual({ Package: packageValue });
    expect(variant!.unitDefinitionId).not.toBeNull();
  });

  test("editing a variant keeps the master name locked", async ({ page, db }) => {
    await page.goto(`/inventory/products/${variantId}`);
    await expect(page.getByRole("heading", { name: variantDisplayName })).toBeVisible();

    await page.getByRole("link", { name: "Edit" }).click();
    await page.waitForURL(new RegExp(`/inventory/products/${variantId}/edit$`), { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Edit Variant" })).toBeVisible();
    await expect(page.getByLabel("Master Name")).toHaveValue(masterName);
    await expect(page.getByLabel("Variant Title")).toHaveValue(variantDisplayName);
    await expect(page.getByLabel("Master Name")).toHaveAttribute("readonly", "");

    await page.getByLabel("Description").fill("Variant description updated");

    const updateResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        response.url().endsWith(`/api/items/${variantId}`)
    );
    await page.getByRole("button", { name: "Save Changes" }).click();
    expect((await updateResponsePromise).status()).toBe(200);

    await page.waitForURL(new RegExp(`/inventory/products/${variantId}$`), { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: variantDisplayName })).toBeVisible();

    const [updatedVariant] = await db.select().from(items).where(eq(items.id, variantId));
    expect(updatedVariant.name).toBe(masterName);
    expect(updatedVariant.description).toBe("Variant description updated");
  });
});
