import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { createItem, getUnitId } from "../helpers/api";

/* ------------------------------------------------------------------ */
/*  Auth — inject session cookie so every test hits an authenticated  */
/*  session without going through the login flow.                     */
/* ------------------------------------------------------------------ */

const env = JSON.parse(fs.readFileSync("test/.test-env.json", "utf-8"));
const SESSION_COOKIE = env.TEST_SESSION_COOKIE; // "better-auth.session_token=…"

function parseCookie(raw: string) {
  const [name, ...rest] = raw.split("=");
  return { name, value: rest.join("=") };
}

async function createMaterialFixture() {
  const materialName = `E2E BOM Material ${Date.now()}`;
  const { status, body } = await createItem({
    name: materialName,
    itemType: "material",
    unitDefinitionId: getUnitId(),
    sku: null,
    category: null,
    description: null,
    defaultPurchasePrice: "1.25",
    defaultSellingPrice: null,
    stock: "0",
    safetyStock: "0",
    bom: [],
  });

  expect(status).toBe(201);
  expect(body).toEqual(expect.objectContaining({ id: expect.any(String) }));

  return {
    id: (body as { id: string }).id,
    name: materialName,
  };
}

test.beforeEach(async ({ context }) => {
  const { name, value } = parseCookie(SESSION_COOKIE);
  await context.addCookies([
    { name, value, domain: "localhost", path: "/" },
  ]);
});

/* ================================================================== */
/*  Tests                                                             */
/* ================================================================== */

test.describe("Product form — create", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/inventory/products/new");
    // Wait for the form card to render
    await expect(page.getByText("Add Product")).toBeVisible();
  });

  /* ---- Happy path ------------------------------------------------ */

  test("creates a product with only required fields", async ({ page }) => {
    // Name (required)
    await page.getByLabel("Name").fill("E2E Test Product");

    // Unit (required) — pick the first available unit
    await page.locator("#unitDefinitionId").click();
    await page.getByRole("option").first().click();

    // Submit
    const submitBtn = page.getByRole("button", { name: "Create Product" });
    await submitBtn.click();

    // Button should show loading state
    await expect(page.getByRole("button", { name: "Creating..." })).toBeVisible();

    // Should redirect to the products list after success
    await page.waitForURL("**/inventory/products");
  });

  /* ---- Validation ------------------------------------------------ */

  test("shows validation error when name is empty", async ({ page }) => {
    // Pick a unit so the only missing required field is name
    await page.locator("#unitDefinitionId").click();
    await page.getByRole("option").first().click();

    // Blur the name field without typing (trigger onBlur validation)
    await page.getByLabel("Name").focus();
    await page.getByLabel("Name").blur();

    // Expect an aria-invalid input
    await expect(page.getByLabel("Name")).toHaveAttribute("aria-invalid", "true");
  });

  test("shows validation error when unit is not selected", async ({ page }) => {
    await page.getByLabel("Name").fill("No-Unit Product");

    // Submit without selecting a unit
    await page.getByRole("button", { name: "Create Product" }).click();

    // The unit field should be marked invalid
    await expect(page.locator("#unitDefinitionId")).toHaveAttribute(
      "aria-invalid",
      "true"
    );
  });

  /* ---- Optional fields ------------------------------------------- */

  test("fills all optional fields and submits", async ({ page }) => {
    await page.getByLabel("Name").fill("Full Product");
    await page.getByLabel("Description").fill("A product with all fields filled");
    await page.getByLabel("SKU").fill(`PROD-E2E-${Date.now()}`);

    // Unit
    await page.locator("#unitDefinitionId").click();
    await page.getByRole("option").first().click();

    // Pricing & stock (Purchase Price is materials-only, not shown for products)
    await page.getByLabel("Selling Price").fill("25.00");
    await page.getByLabel("Stock", { exact: true }).fill("100");
    await page.getByLabel("Safety Stock").fill("10");

    await page.getByRole("button", { name: "Create Product" }).click();
    await page.waitForURL("**/inventory/products");
  });

  /* ---- Category combobox ----------------------------------------- */

  test("can type a new category in the combobox", async ({ page }) => {
    await page.getByLabel("Name").fill("Categorised Product");

    // Unit
    await page.locator("#unitDefinitionId").click();
    await page.getByRole("option").first().click();

    // Type a new category — should show '+ Create "NewCat"'
    const catInput = page.getByPlaceholder("Search or create category...");
    await catInput.click();
    await catInput.fill("NewCat");
    await expect(
      page.getByRole("option", { name: /Create "NewCat"/ })
    ).toBeVisible();
  });

  /* ---- Cancel button --------------------------------------------- */

  test("cancel navigates back to products list", async ({ page }) => {
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.waitForURL("**/inventory/products");
  });
});

/* ================================================================== */
/*  BOM Editor                                                        */
/* ================================================================== */

test.describe("Product form — BOM editor", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/inventory/products/new");
    await expect(page.getByText("Add Product")).toBeVisible();
  });

  test("BOM section is visible on the product form", async ({ page }) => {
    await expect(page.getByText("Recipe / Bill of Materials")).toBeVisible();
    await expect(page.getByText("+ Add Ingredient")).toBeVisible();
  });

  test("can add and remove a BOM row", async ({ page }) => {
    // Add a row
    await page.getByText("+ Add Ingredient").click();

    // A table with Component / Qty / Unit headers should appear
    await expect(page.getByRole("columnheader", { name: "Component" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Qty" })).toBeVisible();

    // Remove the row — click the delete (last) button inside the last table body row
    await page.locator("tbody tr").last().getByRole("button").last().click();

    // Table should disappear (no rows left)
    await expect(page.getByRole("columnheader", { name: "Component" })).not.toBeVisible();
  });

  test("BOM editor stays quantity-only", async ({ page }) => {
    await expect(
      page.getByText("Add ingredients to define what goes into one unit of this product.")
    ).toBeVisible();
    await expect(page.getByRole("radio", { name: "Quantity" })).toHaveCount(0);
    await expect(page.getByRole("radio", { name: "Percentage" })).toHaveCount(0);

    await page.getByText("+ Add Ingredient").click();

    await expect(page.getByRole("columnheader", { name: "Qty" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "%" })).toHaveCount(0);
  });

  test("submits and persists the expected quantity BOM payload", async ({ page }) => {
    const material = await createMaterialFixture();
    const productName = `E2E BOM Product ${Date.now()}`;

    await page.goto("/inventory/products/new");
    await expect(page.getByText("Add Product")).toBeVisible();

    const postRequestPromise = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return request.method() === "POST" && url.pathname === "/api/items";
    });
    const postResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "POST" &&
        url.pathname === "/api/items" &&
        response.status() === 201
      );
    });

    await page.getByLabel("Name").fill(productName);
    await page.locator("#unitDefinitionId").click();
    await page.getByRole("option").first().click();

    await page.getByText("+ Add Ingredient").click();
    const bomRow = page.locator("tbody tr").last();
    await bomRow.getByPlaceholder("Search items...").click();
    await bomRow.getByPlaceholder("Search items...").fill(material.name);
    await page.getByRole("option", { name: material.name }).click();
    await bomRow.locator("input[inputmode='decimal']").fill("2.5");

    await page.getByRole("button", { name: "Create Product" }).click();

    const postRequest = await postRequestPromise;
    const postResponse = await postResponsePromise;
    const payload = postRequest.postDataJSON() as {
      bom?: Array<{ componentId: string; quantity: string | null }>;
      bomMode?: string;
      name: string;
    };
    const created = (await postResponse.json()) as { id: string };

    expect(payload.name).toBe(productName);
    expect(payload).not.toHaveProperty("bomMode");
    expect(payload.bom).toEqual([
      {
        componentId: material.id,
        quantity: "2.5",
      },
    ]);

    await page.waitForURL("**/inventory/products");
    await page.goto(`/inventory/products/${created.id}`);

    const bomTable = page.locator("table").first();
    await expect(page.getByRole("heading", { name: "Recipe / Bill of Materials" })).toBeVisible();
    await expect(bomTable).toContainText(material.name);
    await expect(bomTable).toContainText("2.5");
  });
});

/* ================================================================== */
/*  Create Unit dialog                                                */
/* ================================================================== */

test.describe("Product form — create unit dialog", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/inventory/products/new");
    await expect(page.getByText("Add Product")).toBeVisible();
  });

  test("opens the create-unit dialog", async ({ page }) => {
    // Open unit select and click "+ Create new unit"
    await page.locator("#unitDefinitionId").click();
    await page.getByRole("option", { name: "+ Create new unit" }).click();

    // Dialog should appear
    await expect(page.getByText("Create Unit")).toBeVisible();
    await expect(page.getByText("Define a new unit of measure")).toBeVisible();
  });

  test("create button is disabled until all unit fields are filled", async ({ page }) => {
    await page.locator("#unitDefinitionId").click();
    await page.getByRole("option", { name: "+ Create new unit" }).click();

    // Create button should be disabled initially
    const createBtn = page.getByRole("button", { name: "Create", exact: true });
    await expect(createBtn).toBeDisabled();

    // Fill name only — still disabled (target the dialog's name input by id)
    await page.locator("#unit-name").fill("Test Unit");
    await expect(createBtn).toBeDisabled();

    // Fill size — still disabled (no UOM yet)
    await page.locator("#unit-size").fill("1");
    await expect(createBtn).toBeDisabled();

    // Select a UOM — pick the first option in the UOM select
    await page.locator("#unit-uom").click();
    await page.getByRole("option").first().click();
    await expect(createBtn).toBeEnabled();
  });

  test("shows error for non-numeric unit size", async ({ page }) => {
    await page.locator("#unitDefinitionId").click();
    await page.getByRole("option", { name: "+ Create new unit" }).click();

    await page.locator("#unit-size").fill("abc");
    await page.locator("#unit-size").blur();

    await expect(page.getByText("Must be a positive number")).toBeVisible();
  });

  test("cancel closes the dialog without selecting a unit", async ({ page }) => {
    await page.locator("#unitDefinitionId").click();
    await page.getByRole("option", { name: "+ Create new unit" }).click();

    // The dialog has its own Cancel button — target it inside the dialog
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Cancel" }).click();

    // Dialog should close
    await expect(page.getByText("Define a new unit of measure")).not.toBeVisible();

    // Unit field should still show placeholder (nothing selected)
    await expect(page.locator("#unitDefinitionId")).toContainText("Select a unit");
  });
});
