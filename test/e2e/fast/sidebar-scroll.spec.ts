import { expect, test } from "../fixtures";

test("dashboard table header remains visible after top navigation scrolls away", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 520 });
  await page.goto("/inventory/materials");

  const primaryNav = page.getByRole("navigation", { name: "Primary" });
  const nameHeader = page.getByRole("columnheader", { name: /Name/ }).first();

  await expect(primaryNav).toBeVisible();
  await expect(nameHeader).toBeVisible();

  await page.mouse.wheel(0, 900);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  const navBox = await primaryNav.boundingBox();
  const headerBox = await nameHeader.boundingBox();

  expect(navBox?.y).toBeLessThan(0);
  expect(headerBox?.y).toBeGreaterThanOrEqual(0);
  expect(headerBox?.y).toBeLessThan(180);
});
