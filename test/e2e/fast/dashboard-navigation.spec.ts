import { expect, test } from "../fixtures";

test("page search navigation shows optimistic destination shell while route is pending", async ({
  page,
}) => {
  await page.goto("/sales/orders");
  await expect(page.getByRole("button", { name: "Search pages" })).toBeVisible();

  await page.getByRole("button", { name: "Search pages" }).click();
  await page.getByRole("textbox", { name: "Search pages" }).fill("products");

  let releaseNavigation: () => void = () => {};
  const navigationRequestBlocked = new Promise<void>((resolve) => {
    releaseNavigation = resolve;
  });

  await page.route(
    (url) => url.pathname === "/inventory/products",
    async (route) => {
      await navigationRequestBlocked;
      await route.continue();
    },
    { times: 1 }
  );

  await page.getByRole("button", { name: /Inventory - Products/ }).click();

  const shell = page.getByTestId("optimistic-dashboard-shell");
  await expect(shell).toBeVisible();
  await expect(shell.getByRole("heading")).toHaveCount(0);
  await expect(page.getByTestId("data-table-loading")).toBeVisible();
  const spinnerBox = await page.getByRole("status", { name: "Loading" }).boundingBox();
  expect(spinnerBox?.width).toBeGreaterThanOrEqual(32);
  expect(spinnerBox?.height).toBeGreaterThanOrEqual(32);
  await expect(
    page.getByRole("link", { name: "Products", exact: true })
  ).toHaveClass(/text-primary/);

  releaseNavigation();

  await expect(page).toHaveURL(/\/inventory\/products/);
  await expect(shell).toHaveCount(0);
});
