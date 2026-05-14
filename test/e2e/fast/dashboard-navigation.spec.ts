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
  await expect(page.getByTestId("optimistic-data-region")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Products", exact: true })
  ).toHaveClass(/text-primary/);

  await expect(shell).toHaveCount(0);
  await expect(page).toHaveURL(/\/inventory\/products/);
});
