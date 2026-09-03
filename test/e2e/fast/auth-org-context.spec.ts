import { request } from "@playwright/test";
import { eq } from "drizzle-orm";
import { test, expect } from "../fixtures";
import { organization } from "../../../lib/db/schema";
import { getOrgId } from "../../helpers/api";
import { resolveBaseUrl } from "../../helpers/test-env";

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

// The support triage routine's proof that a merge is live: /api/version must
// stay public, uncached, and report the commit the server was built from
// (null outside Vercel, a 40-hex sha on Vercel).
test("/api/version is public, uncached, and reports the build commit", async () => {
  const anonymous = await request.newContext({
    baseURL: resolveBaseUrl(),
    storageState: undefined,
    extraHTTPHeaders: {},
  });
  try {
    const first = await anonymous.get("/api/version");
    expect(first.status(), await first.text()).toBe(200);
    expect(first.headers()["content-type"]).toContain("application/json");
    expect(first.headers()["cache-control"]).toContain("no-store");

    const body = (await first.json()) as {
      commitSha: string | null;
      environment: string | null;
      deploymentId: string | null;
      checkedAt: string;
    };
    expect(Object.keys(body).sort()).toEqual([
      "checkedAt",
      "commitSha",
      "deploymentId",
      "environment",
    ]);
    expect(body.commitSha === null || /^[0-9a-f]{40}$/.test(body.commitSha)).toBe(true);
    expect(body.commitSha).toBe(process.env.VERCEL_GIT_COMMIT_SHA ?? null);
    expect(Number.isNaN(Date.parse(body.checkedAt))).toBe(false);

    const second = await anonymous.get("/api/version");
    const later = (await second.json()) as { checkedAt: string };
    expect(Date.parse(later.checkedAt)).toBeGreaterThanOrEqual(Date.parse(body.checkedAt));
  } finally {
    await anonymous.dispose();
  }
});
