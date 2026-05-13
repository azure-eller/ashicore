import { expect, test } from "../fixtures";

test("dashboard top navigation remains visible at compact height", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 520 });
  await page.goto("/purchasing/orders/new");

  await expect(
    page.getByRole("heading", { name: "Add Purchase Order" })
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Purchasing" })).toBeVisible();
});
