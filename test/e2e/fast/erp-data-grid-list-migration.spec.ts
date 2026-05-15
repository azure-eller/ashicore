import { and, eq, isNull } from "drizzle-orm";
import { expect, test, filterList } from "../fixtures";
import { items, unitDefinitions } from "../../../lib/db/schema";
import { readTestEnv } from "../../helpers/test-env";

const { TEST_ORG_ID: testOrgId } = readTestEnv();

const migratedListPages = [
  {
    path: "/inventory/materials",
    searchLabel: "Search items",
    addLabel: "New Material",
    header: "Name",
  },
  {
    path: "/inventory/products",
    searchLabel: "Search items",
    addLabel: "New Product",
    header: "Name",
  },
  {
    path: "/inventory/sub-assemblies",
    searchLabel: "Search items",
    addLabel: "New Product",
    header: "Name",
  },
  {
    path: "/manufacturing/orders",
    searchLabel: "Search manufacturing orders",
    addLabel: "New Order",
    header: "Order",
  },
  {
    path: "/purchasing/orders",
    searchLabel: "Search purchase orders",
    addLabel: "New Purchase Order",
    header: "Order",
  },
  {
    path: "/purchasing/suppliers",
    searchLabel: "Search suppliers",
    addLabel: "New Supplier",
    header: "Name",
  },
  {
    path: "/sales/customers",
    searchLabel: "Search customers",
    addLabel: "New Customer",
    header: "Name",
  },
  {
    path: "/sales/pricing",
    searchLabel: "Search pricing schedules",
    addLabel: "New Pricing Schedule",
    header: "Schedule",
  },
  {
    path: "/inventory/stocktakes",
    searchLabel: "Search stocktakes",
    addLabel: "New Stocktake",
    header: "Name",
  },
] as const;

test("migrated list pages render AG Grid shells", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      const text = message.text();
      if (!text.includes("DeprecationWarning: Calling client.query()")) {
        runtimeErrors.push(text);
      }
    }
  });

  for (const listPage of migratedListPages) {
    await page.goto(listPage.path);
    await expect(page.getByLabel(listPage.searchLabel)).toBeVisible();
    await expect(page.getByRole("link", { name: listPage.addLabel })).toBeVisible();
    await expect(page.locator('[data-slot="erp-data-grid"]')).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: listPage.header }).first()
    ).toBeVisible();
    await expect(page.locator(".ag-body-viewport")).toBeVisible();
  }

  expect(runtimeErrors).toEqual([]);
});

test("bulk delete failure keeps selection and shows the API error", async ({
  page,
  db,
}) => {
  const materialName = `Delete Failure Material ${Date.now()}`;
  let [unit] = await db
    .select({ id: unitDefinitions.id })
    .from(unitDefinitions)
    .where(isNull(unitDefinitions.deletedAt))
    .limit(1);

  if (!unit) {
    [unit] = await db
      .insert(unitDefinitions)
      .values({
        organizationId: testOrgId,
        name: "Each",
        size: "1",
        uom: "ea",
      })
      .returning({ id: unitDefinitions.id });
  }

  await db.insert(items).values({
    organizationId: testOrgId,
    name: materialName,
    sku: `DEL-FAIL-${Date.now()}`,
    itemType: "material",
    unitDefinitionId: unit.id,
    sellable: false,
  });

  await page.route("**/api/items", async (route) => {
    if (route.request().method() === "DELETE") {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Cannot delete item because it is used by active orders.",
        }),
      });
      return;
    }

    await route.continue();
  });

  await page.goto("/inventory/materials");
  await filterList(page, "Search items", materialName);

  const row = page.locator(".ag-row", { hasText: materialName }).first();
  await expect(row).toBeVisible();
  await row.locator(".ag-selection-checkbox").click();

  const deleteButton = page.getByRole("button", { name: "Delete 1 selected" });
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();

  await expect(
    page.getByRole("heading", { name: "Delete 1 item?" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(
    page.getByRole("alert").filter({
      hasText: "Cannot delete item because it is used by active orders.",
    })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Delete 1 item?" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(deleteButton).toBeVisible();

  const [material] = await db
    .select({ deletedAt: items.deletedAt })
    .from(items)
    .where(and(eq(items.name, materialName), isNull(items.deletedAt)));

  expect(material).toBeTruthy();
});
