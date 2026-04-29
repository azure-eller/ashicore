import { expect, test } from "../fixtures";

test("dashboard sidebar scrolls when browser zoom leaves less vertical space", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 520 });
  await page.goto("/purchasing/orders/new");

  await expect(
    page.getByRole("heading", { name: "Add Purchase Order" })
  ).toBeVisible();

  const viewport = page
    .locator("[data-slot=sidebar-content] [data-slot=scroll-area-viewport]")
    .first();
  const scrollbar = page
    .locator("[data-slot=sidebar-content] [data-slot=scroll-area-scrollbar]")
    .first();

  await expect(scrollbar).toBeVisible();

  const before = await viewport.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
  }));

  expect(before.scrollHeight).toBeGreaterThan(before.clientHeight);
  expect(before.scrollTop).toBe(0);

  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });

  const after = await viewport.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
  }));

  expect(after.scrollTop).toBeGreaterThan(0);
  expect(after.scrollHeight).toBeGreaterThan(after.clientHeight);
});
