import { expect, test } from "../fixtures";

test("page search navigation shows optimistic destination shell while route is pending", async ({
  page,
}) => {
  await page.goto("/sales/orders");
  await expect(page.getByRole("button", { name: "Search pages" })).toBeVisible();

  await page.route(/\/inventory\/products(?:\?|$)/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 750));
    await route.continue();
  });

  await page.getByRole("button", { name: "Search pages" }).click();
  await page.getByRole("textbox", { name: "Search pages" }).fill("products");
  await page.getByRole("button", { name: /Inventory - Products/ }).click();

  const shell = page.getByTestId("optimistic-dashboard-shell");
  await expect(shell).toBeVisible();
  await expect(shell.getByRole("heading")).toHaveCount(0);
  const optimisticDataRegion = page.getByTestId("optimistic-data-region");
  if ((await optimisticDataRegion.count()) > 0) {
    await expect(optimisticDataRegion).toBeVisible();
  }
  await expect(page.getByTestId("data-table-loading")).toBeVisible();
  const spinnerBox = await page.getByRole("status", { name: "Loading" }).boundingBox();
  expect(spinnerBox?.width).toBeGreaterThanOrEqual(32);
  expect(spinnerBox?.height).toBeGreaterThanOrEqual(32);
  await expect(
    page.getByRole("link", { name: "Products", exact: true })
  ).toHaveClass(/text-primary/);

  await expect(shell).toHaveCount(0);
  await expect(page).toHaveURL(/\/inventory\/products/);
});
