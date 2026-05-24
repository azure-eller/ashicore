import { eq } from "drizzle-orm";
import { test, expect } from "../fixtures";
import { organization } from "../../../lib/db/schema";
import { getOrgId } from "../../helpers/api";

test("authenticated browser context has an active organization", async ({
  page,
  db,
}) => {
  await page.goto("/sales/orders");
  await expect(page.locator("main")).toBeVisible();

  const itemsStatus = await page.evaluate(async () => {
    const response = await fetch("/api/items");
    return response.status;
  });
  expect(itemsStatus).toBe(200);

  const [org] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, getOrgId()));

  expect(org?.id).toBe(getOrgId());
});
