import fs from "node:fs";
import { Client } from "pg";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { expect, test, type TestDb } from "./fixtures";
import { invitation, member, organization, user } from "../../lib/db/schema";

const env = JSON.parse(fs.readFileSync("test/.test-env.json", "utf-8"));
const SESSION_COOKIE = env.TEST_SESSION_COOKIE;
const TEST_ORG_ID = env.TEST_ORG_ID;
const BASE_URL = env.TEST_BASE_URL ?? "http://localhost:3000";
const BLOCKED_ROUTE_ID = "11111111-1111-1111-1111-111111111111";

function parseCookie(raw: string) {
  const [name, ...rest] = raw.split("=");
  return { name, value: rest.join("=") };
}

async function addSessionCookie(context: BrowserContext, rawCookie: string) {
  const { name, value } = parseCookie(rawCookie);
  await context.addCookies([{ name, value, domain: "localhost", path: "/" }]);
}

function extractSetCookieHeaders(response: Response) {
  const headersWithSetCookie = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookieHeaders = headersWithSetCookie.getSetCookie?.() ?? [];

  if (setCookieHeaders.length > 0) {
    return setCookieHeaders;
  }

  const cookies: string[] = [];
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      cookies.push(value);
    }
  });
  return cookies;
}

async function addAuthCookies(context: BrowserContext, setCookieHeaders: string[]) {
  const domain = new URL(BASE_URL).hostname;
  await context.addCookies(
    setCookieHeaders.map((rawCookie) => {
      const [cookiePair] = rawCookie.split(";");
      const { name, value } = parseCookie(cookiePair);
      return { name, value, domain, path: "/" };
    })
  );
}

async function createFreshPage(browser: Browser) {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  return { context, page };
}

async function markUserMfaEnrolled(db: TestDb, email: string) {
  await db
    .update(user)
    .set({ twoFactorEnabled: true })
    .where(eq(user.email, email));
}

async function setUserMfaEnrollment(email: string, enabled: boolean) {
  const connectionString = process.env.DATABASE_URL ?? process.env.DATABASE_URL_APP;

  if (!connectionString) {
    return;
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query(
      'UPDATE system."user" SET two_factor_enabled = $1, updated_at = NOW() WHERE email = $2',
      [enabled, email]
    );
  } finally {
    await client.end();
  }
}

async function signInAsExistingUser(
  browser: Browser,
  email: string,
  password: string,
  expectedPath: string
) {
  const { context, page } = await createFreshPage(browser);
  await setUserMfaEnrollment(email, false);
  const signInResponse = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: BASE_URL,
    },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  });
  const setCookieHeaders = extractSetCookieHeaders(signInResponse);

  if (setCookieHeaders.length === 0) {
    const body = await signInResponse.text().catch(() => "");
    throw new Error(
      `Failed to authenticate ${email}. Status: ${signInResponse.status}, Body: ${body}`
    );
  }

  await addAuthCookies(context, setCookieHeaders);
  await setUserMfaEnrollment(email, true);
  await page.goto(expectedPath);
  await page.waitForURL(`**${expectedPath}`, { timeout: 15_000 });

  return { context, page };
}

async function acceptInviteAsNewUser(
  browser: Browser,
  db: TestDb,
  invitationId: string,
  email: string,
  name: string,
  password: string,
  expectedPath = "/settings/account"
) {
  const { context, page } = await createFreshPage(browser);
  await page.goto(`/accept-invitation?id=${invitationId}`);
  await expect(page.getByLabel("Email")).toHaveValue(email);
  await page.getByLabel("Full Name").fill(name);
  await page.getByLabel(/^Password$/).fill(password);
  await page.getByLabel(/^Confirm Password$/).fill(password);
  await page.locator("form").getByRole("button", { name: "Create Account" }).click();
  await page.waitForURL(
    (url) => ["/two-factor", expectedPath].includes(url.pathname),
    { timeout: 15_000 }
  );
  await markUserMfaEnrolled(db, email);

  if (new URL(page.url()).pathname === "/two-factor") {
    await page.goto(expectedPath);
  }

  return { context, page };
}

async function apiCall<T>(
  page: Page,
  path: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
  } = {}
): Promise<{ status: number; body: T | null }> {
  return page.evaluate(
    async ({ path, method, body }) => {
      const resolvedMethod = method ?? "GET";
      const headers: Record<string, string> = {};

      if (body) {
        headers["Content-Type"] = "application/json";
      }

      if (resolvedMethod !== "GET" && resolvedMethod !== "HEAD") {
        headers["Idempotency-Key"] = `${resolvedMethod}:${path}:${crypto.randomUUID()}`;
      }

      const response = await fetch(path, {
        method: resolvedMethod,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      return {
        status: response.status,
        body: await response.json().catch(() => null),
      };
    },
    { path, method: options.method, body: options.body }
  );
}

async function ownerApiCall<T>(
  page: Page,
  path: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
  } = {}
): Promise<{ status: number; body: T | null }> {
  if (!page.url().startsWith(BASE_URL)) {
    await page.goto("/settings/account");
  }

  return apiCall<T>(page, path, options);
}

function expectRoleIncludes(storedRole: string | null, expectedRoles: string[]) {
  expect(storedRole).toBeTruthy();
  if (!storedRole) return;

  const assignedRoles = storedRole.split(",").map((value) => value.trim());
  expect(assignedRoles).toEqual(expect.arrayContaining(expectedRoles));
}

test.beforeEach(async ({ context }) => {
  await addSessionCookie(context, SESSION_COOKIE);
});

test.describe("Team access", () => {
  test.describe.configure({ mode: "serial" });

  const run = Date.now();
  const operatorEmail = `team-operator-${run}@example.com`;
  const adminEmail = `team-admin-${run}@example.com`;
  const operatorPassword = "MemberPassword123!";
  const adminPassword = "AdminPassword123!";
  const orgOwnerEmail = `owner-${run}@example.com`;
  const orgOwnerPassword = "OwnerPassword123!";

  let operatorInvitationId = "";
  let operatorMemberId = "";
  let operatorUserId = "";

  async function updateOperatorAccess(
    page: Page,
    moduleAccess: {
      inventory: "none" | "read" | "operate" | "admin";
      sales: "none" | "read" | "operate" | "admin";
      manufacturing: "none" | "read" | "operate" | "admin";
      purchasing: "none" | "read" | "operate" | "admin";
      settings: "none" | "read" | "operate" | "admin";
    }
  ) {
    const response = await ownerApiCall<{ error?: string }>(
      page,
      `/api/team/members/${operatorMemberId}`,
      {
        method: "PATCH",
        body: { moduleAccess },
      }
    );

    expect(response.status).toBe(200);
  }

  test("first owner can sign up and create an organization", async ({ browser, db }) => {
    const { context, page } = await createFreshPage(browser);

    await page.goto("/sign-up");
    await page.getByLabel("Full Name").fill(`Fresh Owner ${run}`);
    await page.getByLabel("Work email").fill(orgOwnerEmail);
    await page.getByLabel(/^Password$/).fill(orgOwnerPassword);
    await page.getByLabel(/^Confirm Password$/).fill(orgOwnerPassword);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL((url) =>
      ["/two-factor", "/org-setup"].includes(url.pathname)
    );
    await markUserMfaEnrolled(db, orgOwnerEmail);
    await page.goto("/org-setup");

    const orgName = `Fresh Org ${run}`;
    await page.getByLabel("Organization name").fill(orgName);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL("**/onboarding?plan=free");

    const [ownerUser] = await db.select().from(user).where(eq(user.email, orgOwnerEmail));
    expect(ownerUser).toBeTruthy();

    const [freshOrg] = await db
      .select()
      .from(organization)
      .where(eq(organization.name, orgName));
    expect(freshOrg).toBeTruthy();

    const [ownerMember] = await db
      .select()
      .from(member)
      .where(and(eq(member.organizationId, freshOrg.id), eq(member.userId, ownerUser.id)));
    expect(ownerMember.role).toBe("owner");

    await context.close();
  });

  test("owner invite creates a sales operator membership", async ({ browser, db, page }) => {
    await page.goto("/settings/team");
    await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();

    await page.getByRole("button", { name: "Invite member" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Email").fill(operatorEmail);
    await dialog.locator("button").filter({ hasText: "Sales Operator" }).first().click();
    const inviteResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/team/invitations") &&
        response.request().method() === "POST"
    );
    await page.getByRole("button", { name: "Send invite" }).click();
    await inviteResponse;
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const [operatorInvite] = await db
      .select()
      .from(invitation)
      .where(and(eq(invitation.organizationId, TEST_ORG_ID), eq(invitation.email, operatorEmail)));
    expectRoleIncludes(operatorInvite.role, [
      "access:matrix",
      "member",
      "inventory:read",
      "sales:operate",
      "manufacturing:read",
      "purchasing:read",
    ]);
    operatorInvitationId = operatorInvite.id;

    const accepted = await acceptInviteAsNewUser(
      browser,
      db,
      operatorInvitationId,
      operatorEmail,
      `Team Operator ${run}`,
      operatorPassword
    );

    const [operatorUser] = await db.select().from(user).where(eq(user.email, operatorEmail));
    expect(operatorUser).toBeTruthy();
    operatorUserId = operatorUser.id;

    const [operatorMember] = await db
      .select()
      .from(member)
      .where(and(eq(member.organizationId, TEST_ORG_ID), eq(member.userId, operatorUser.id)));
    expectRoleIncludes(operatorMember.role, [
      "access:matrix",
      "member",
      "inventory:read",
      "sales:operate",
      "manufacturing:read",
      "purchasing:read",
    ]);
    operatorMemberId = operatorMember.id;

    await accepted.context.close();

    // Owner adjusts the new member's access inline from the team table, then
    // puts it back.
    await page.reload();
    const operatorRow = page.getByRole("row").filter({ hasText: operatorEmail });
    await operatorRow.getByRole("button", { name: "Sales Operator" }).click();
    await page.getByRole("menuitem", { name: "Ops Operator" }).click();
    await expect(
      operatorRow.getByRole("button", { name: "Ops Operator" })
    ).toBeVisible();
    const [reassigned] = await db
      .select()
      .from(member)
      .where(eq(member.id, operatorMemberId));
    expectRoleIncludes(reassigned.role, [
      "access:matrix",
      "member",
      "inventory:read",
      "sales:read",
      "manufacturing:operate",
      "purchasing:read",
    ]);

    await operatorRow.getByRole("button", { name: "Ops Operator" }).click();
    await page.getByRole("menuitem", { name: "Sales Operator" }).click();
    await expect(
      operatorRow.getByRole("button", { name: "Sales Operator" })
    ).toBeVisible();
    const [restored] = await db
      .select()
      .from(member)
      .where(eq(member.id, operatorMemberId));
    expectRoleIncludes(restored.role, [
      "access:matrix",
      "member",
      "inventory:read",
      "sales:operate",
      "manufacturing:read",
      "purchasing:read",
    ]);
  });

  test("sales operator can use sales but cannot mutate other modules", async ({ browser }) => {
    const { context, page } = await signInAsExistingUser(
      browser,
      operatorEmail,
      operatorPassword,
      "/sales/orders"
    );

    await expect(page.getByRole("link", { name: "Sales", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);

    const allowedSalesMutation = await apiCall<{ error?: string; errors?: Record<string, string[]> }>(
      page,
      "/api/customers",
      { method: "POST", body: {} }
    );
    expect(allowedSalesMutation.status).not.toBe(403);

    const blockedInventoryMutation = await apiCall<{ error?: string }>(page, "/api/items", {
      method: "POST",
      body: {},
    });
    expect(blockedInventoryMutation.status).toBe(403);

    const blockedManufacturingMutation = await apiCall<{ error?: string }>(
      page,
      `/api/sales-orders/${BLOCKED_ROUTE_ID}/manufacturing-orders`,
      {
        method: "POST",
        body: {
          plannedDate: null,
          notes: null,
        },
      }
    );
    expect(blockedManufacturingMutation.status).toBe(403);

    const blockedPurchasingMutation = await apiCall<{ error?: string }>(
      page,
      `/api/purchase-orders/${BLOCKED_ROUTE_ID}/receive`,
      { method: "POST", body: {} }
    );
    expect(blockedPurchasingMutation.status).toBe(403);

    const blockedTeamMutation = await apiCall<{ error?: string }>(
      page,
      `/api/team/members/${operatorMemberId}`,
      {
        method: "PATCH",
        body: {
          moduleAccess: {
            inventory: "admin",
            sales: "admin",
            manufacturing: "admin",
            purchasing: "admin",
            settings: "admin",
          },
        },
      }
    );
    expect(blockedTeamMutation.status).toBe(403);

    await context.close();
  });

  test("settings admin can invite but cannot grant team-management powers", async ({
    browser,
    db,
    page,
  }) => {
    const inviteResponse = await ownerApiCall<{ error?: string }>(page, "/api/team/invitations", {
      method: "POST",
      body: { email: adminEmail, presetKey: "admin" },
    });
    expect(inviteResponse.status).toBe(200);

    const [adminInvite] = await db
      .select()
      .from(invitation)
      .where(and(eq(invitation.organizationId, TEST_ORG_ID), eq(invitation.email, adminEmail)));
    expectRoleIncludes(adminInvite.role, [
      "access:matrix",
      "member",
      "inventory:admin",
      "sales:admin",
      "manufacturing:admin",
      "purchasing:admin",
      "settings:admin",
    ]);

    const accepted = await acceptInviteAsNewUser(
      browser,
      db,
      adminInvite.id,
      adminEmail,
      `Team Admin ${run}`,
      adminPassword
    );
    await accepted.context.close();

    // An invited admin joins an already-set-up org, so signing in lands them in
    // the app (the existing-user redirect), not the onboarding flow — same as the
    // operator above. The team-management authz checks below are the real subject.
    const { context, page: adminPage } = await signInAsExistingUser(
      browser,
      adminEmail,
      adminPassword,
      "/sales/orders"
    );
    await adminPage.goto("/settings/team");
    await expect(adminPage.getByRole("heading", { name: "Team" })).toBeVisible();

    const allowedInvite = await apiCall<{ error?: string }>(
      adminPage,
      "/api/team/invitations",
      {
        method: "POST",
        body: {
          email: `settings-admin-invite-${run}@example.com`,
          presetKey: "view_only",
        },
      }
    );
    expect(allowedInvite.status).toBe(200);

    const blockedGrant = await apiCall<{ error?: string }>(
      adminPage,
      `/api/team/members/${operatorMemberId}`,
      {
        method: "PATCH",
        body: {
          moduleAccess: {
            inventory: "none",
            sales: "none",
            manufacturing: "none",
            purchasing: "none",
            settings: "admin",
          },
        },
      }
    );
    expect(blockedGrant.status).toBe(403);

    await context.close();
  });

  test("owner can remove a member without deleting the auth account", async ({ db, page }) => {
    await updateOperatorAccess(page, {
      inventory: "read",
      sales: "operate",
      manufacturing: "read",
      purchasing: "read",
      settings: "none",
    });

    const removeResponse = await ownerApiCall<{ error?: string }>(
      page,
      `/api/team/members/${operatorMemberId}`,
      { method: "DELETE" }
    );
    expect(removeResponse.status).toBe(200);

    const memberRows = await db
      .select()
      .from(member)
      .where(eq(member.id, operatorMemberId));
    expect(memberRows).toHaveLength(0);

    const [persistedUser] = await db.select().from(user).where(eq(user.id, operatorUserId));
    expect(persistedUser.email).toBe(operatorEmail);
  });
});
