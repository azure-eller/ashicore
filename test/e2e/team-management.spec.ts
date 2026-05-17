import fs from "node:fs";
import { Client } from "pg";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { expect, test, type TestDb } from "./fixtures";
import {
  invitation,
  items,
  member,
  organization,
  unitDefinitions,
  user,
} from "../../lib/db/schema";
import {
  TEST_ACCOUNT_EMAIL,
  TEST_ACCOUNT_PASSWORD,
} from "../helpers/test-account";

const env = JSON.parse(fs.readFileSync("test/.test-env.json", "utf-8"));
const SESSION_COOKIE = env.TEST_SESSION_COOKIE;
const TEST_ORG_ID = env.TEST_ORG_ID;
const BASE_URL = env.TEST_BASE_URL ?? "http://localhost:3000";
const BLOCKED_ROUTE_ID = "11111111-1111-1111-1111-111111111111";
const TEST_OWNER_EMAIL = TEST_ACCOUNT_EMAIL;
const TEST_OWNER_PASSWORD = TEST_ACCOUNT_PASSWORD;

function parseCookie(raw: string) {
  const [name, ...rest] = raw.split("=");
  return { name, value: rest.join("=") };
}

function pendingInviteCard(page: Page, email: string) {
  return page.locator(`[data-email="${email}"]`).first();
}

async function expectModuleLinkVisible(page: Page, moduleName: string, href: string) {
  const link = page.getByRole("link", { name: moduleName, exact: true });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", href);
}

async function expectModuleHidden(page: Page, moduleName: string) {
  await expect(page.getByRole("link", { name: moduleName, exact: true })).toHaveCount(0);
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
  expectedPath: string | string[] = "/settings"
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
  const expectedPaths = Array.isArray(expectedPath) ? expectedPath : [expectedPath];
  await setUserMfaEnrollment(email, true);

  await page.goto(expectedPaths.includes("/accept-invitation") ? "/org-setup" : expectedPaths[0]);
  await page.waitForURL(
    (url) =>
      expectedPaths.includes(url.pathname) ||
      (expectedPaths.includes("/org-setup") && url.pathname === "/accept-invitation"),
    { timeout: 15_000 }
  );

  return { context, page };
}

async function createStandaloneAccount(
  browser: Browser,
  db: TestDb,
  email: string,
  name: string,
  password: string
) {
  const { context, page } = await createFreshPage(browser);
  await page.goto("/sign-up");
  await page.getByLabel("Full Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/^Password$/).fill(password);
  await page.getByLabel(/^Confirm Password$/).fill(password);
  await page.getByRole("button", { name: "Create Account" }).click();
  await page.waitForURL(
    (url) => ["/", "/mfa-setup", "/org-setup", "/settings"].includes(url.pathname),
    { timeout: 15_000 }
  );
  await markUserMfaEnrolled(db, email);

  if (new URL(page.url()).pathname === "/mfa-setup") {
    await page.goto("/org-setup");
  }

  return { context, page };
}

async function acceptInviteAsNewUser(
  browser: Browser,
  db: TestDb,
  invitationId: string,
  email: string,
  name: string,
  password: string,
  expectedPath = "/settings"
) {
  const { context, page } = await createFreshPage(browser);
  await page.goto(`/accept-invitation?id=${invitationId}`);
  await expect(page.getByLabel("Email")).toHaveValue(email);
  await page.getByLabel("Full Name").fill(name);
  await page.getByLabel(/^Password$/).fill(password);
  await page.getByLabel(/^Confirm Password$/).fill(password);
  await page.locator("form").getByRole("button", { name: "Create Account" }).click();
  await page.waitForURL(
    (url) => ["/mfa-setup", expectedPath].includes(url.pathname),
    { timeout: 15_000 }
  );
  await markUserMfaEnrolled(db, email);

  if (new URL(page.url()).pathname === "/mfa-setup") {
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
    await page.goto("/settings");
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

test.describe("Team management and invite flow", () => {
  test.describe.configure({ mode: "serial" });

  const run = Date.now();
  const memberEmail = `member-${run}@example.com`;
  const adminEmail = `admin-${run}@example.com`;
  const opsOperatorEmail = `ops-operator-${run}@example.com`;
  const memberPassword = "MemberPassword123!";
  const adminPassword = "AdminPassword123!";
  const existingPassword = "ExistingPassword123!";
  const memberName = `Member ${run}`;
  const adminName = `Admin ${run}`;
  const orgOwnerEmail = `owner-${run}@example.com`;
  const orgOwnerPassword = "OwnerPassword123!";

  let memberInvitationId = "";
  let adminInvitationId = "";
  let memberMemberId = "";
  let memberUserId = "";
  let unlockedProductId = "";

  async function updateMemberAccess(
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
      `/api/team/members/${memberMemberId}`,
      {
        method: "PATCH",
        body: {
          moduleAccess,
        },
      }
    );

    expect(response.status).toBe(200);
  }

  test("public sign-up and org creation still work for a first owner", async ({ browser, db }) => {
    const { context, page } = await createFreshPage(browser);

    await page.goto("/sign-up");
    await page.getByLabel("Full Name").fill(`Fresh Owner ${run}`);
    await page.getByLabel("Email").fill(orgOwnerEmail);
    await page.getByLabel(/^Password$/).fill(orgOwnerPassword);
    await page.getByLabel(/^Confirm Password$/).fill(orgOwnerPassword);
    await page.getByRole("button", { name: "Create Account" }).click();
    await page.waitForURL("**/mfa-setup");
    await markUserMfaEnrolled(db, orgOwnerEmail);
    await page.goto("/org-setup");

    const orgName = `Fresh Org ${run}`;
    await page.getByLabel("Organization name").fill(orgName);
    await page.getByRole("button", { name: "Create Organization" }).click();
    await page.waitForURL("**/sales/orders");

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

  test("owner invites users from Settings > Team", async ({ page, db }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();

    const inviteMember = async (email: string, presetLabel: string) => {
      await page.getByRole("button", { name: "Invite member" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Email").fill(email);
      await dialog.locator("button").filter({ hasText: presetLabel }).first().click();
      const inviteResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/team/invitations") &&
          response.request().method() === "POST"
      );
      await page.getByRole("button", { name: "Send invite" }).click();
      await inviteResponse;
      await expect(page.getByRole("dialog")).toHaveCount(0);
    };

    await inviteMember(memberEmail, "Sales Operator");
    await inviteMember(opsOperatorEmail, "Ops Operator");
    await inviteMember(adminEmail, "Admin");

    const [memberInvite] = await db
      .select()
      .from(invitation)
      .where(and(eq(invitation.organizationId, TEST_ORG_ID), eq(invitation.email, memberEmail)));
    const [adminInvite] = await db
      .select()
      .from(invitation)
      .where(and(eq(invitation.organizationId, TEST_ORG_ID), eq(invitation.email, adminEmail)));
    const [opsOperatorInvite] = await db
      .select()
      .from(invitation)
      .where(
        and(eq(invitation.organizationId, TEST_ORG_ID), eq(invitation.email, opsOperatorEmail))
      );

    expectRoleIncludes(memberInvite.role, [
      "access:matrix",
      "member",
      "inventory:read",
      "sales:operate",
      "manufacturing:read",
      "purchasing:read",
    ]);
    expectRoleIncludes(adminInvite.role, [
      "access:matrix",
      "member",
      "inventory:admin",
      "sales:admin",
      "manufacturing:admin",
      "purchasing:admin",
      "settings:admin",
    ]);
    expectRoleIncludes(opsOperatorInvite.role, [
      "access:matrix",
      "member",
      "inventory:read",
      "sales:read",
      "manufacturing:operate",
      "purchasing:read",
    ]);

    await page.reload();
    await expect(pendingInviteCard(page, memberEmail)).toBeVisible();
    await expect(pendingInviteCard(page, opsOperatorEmail)).toBeVisible();
    await expect(pendingInviteCard(page, adminEmail)).toBeVisible();

    memberInvitationId = memberInvite.id;
    adminInvitationId = adminInvite.id;
  });

  test("logged-in owner can log out from invite mismatch and continue in auth form", async ({
    browser,
    db,
  }) => {
    let inviteId = memberInvitationId;

    if (!inviteId) {
      const { context, page } = await signInAsExistingUser(
        browser,
        TEST_OWNER_EMAIL,
        TEST_OWNER_PASSWORD,
        "/inventory/materials"
      );

      await page.goto("/settings");
      const inviteEmail = `switch-${run}@example.com`;
      const response = await apiCall<{ error?: string }>(page, "/api/team/invitations", {
        method: "POST",
        body: { email: inviteEmail, presetKey: "view_only" },
      });
      expect(response.status).toBe(200);

      const [invite] = await db
        .select()
        .from(invitation)
        .where(and(eq(invitation.organizationId, TEST_ORG_ID), eq(invitation.email, inviteEmail)));
      inviteId = invite?.id ?? "";

      await context.close();
    }

    expect(inviteId).toBeTruthy();

    const { context, page } = await signInAsExistingUser(
      browser,
      TEST_OWNER_EMAIL,
      TEST_OWNER_PASSWORD,
      ["/inventory/materials", "/org-setup"]
    );

    await page.goto(`/accept-invitation?id=${inviteId}`);
    await expect(page.getByText("Switch accounts to continue")).toBeVisible();

    await page.getByRole("button", { name: "Log out" }).click();

    await expect(page.locator("form").getByRole("button", { name: "Create Account" })).toBeEnabled();
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page.locator("form").getByRole("button", { name: "Sign In" })).toBeEnabled();

    await context.close();
  });

  test("existing account can sign in from an invite and join", async ({
    browser,
    db,
    page,
  }) => {
    const existingEmail = `existing-invite-${run}@example.com`;
    const existingName = `Existing Invite ${run}`;
    const existing = await createStandaloneAccount(
      browser,
      db,
      existingEmail,
      existingName,
      existingPassword
    );
    await existing.context.close();

    await page.goto("/settings");
    const response = await apiCall<{ error?: string }>(page, "/api/team/invitations", {
      method: "POST",
      body: { email: existingEmail, presetKey: "view_only" },
    });
    expect(response.status).toBe(200);

    const [invite] = await db
      .select()
      .from(invitation)
      .where(and(eq(invitation.organizationId, TEST_ORG_ID), eq(invitation.email, existingEmail)));
    expect(invite).toBeTruthy();

    const invited = await createFreshPage(browser);
    await invited.page.goto(`/accept-invitation?id=${invite.id}`);
    await expect(invited.page.getByLabel("Email")).toHaveValue(existingEmail);
    await invited.page.getByLabel("Full Name").fill(existingName);
    await invited.page.getByLabel(/^Password$/).fill(existingPassword);
    await invited.page.getByLabel(/^Confirm Password$/).fill(existingPassword);
    await invited.page.locator("form").getByRole("button", { name: "Create Account" }).click();

    await expect(
      invited.page.getByText("This email already has an account. Sign in to accept the invite.")
    ).toBeVisible();
    await setUserMfaEnrollment(existingEmail, false);
    await invited.page.locator("form").getByRole("button", { name: "Sign In" }).click();
    await invited.page.waitForURL("**/settings", { timeout: 15_000 });
    await setUserMfaEnrollment(existingEmail, true);

    const [existingUser] = await db.select().from(user).where(eq(user.email, existingEmail));
    expect(existingUser).toBeTruthy();

    const [existingMember] = await db
      .select()
      .from(member)
      .where(and(eq(member.organizationId, TEST_ORG_ID), eq(member.userId, existingUser.id)));
    expectRoleIncludes(existingMember.role, [
      "access:matrix",
      "member",
      "inventory:read",
      "sales:read",
      "manufacturing:read",
      "purchasing:read",
    ]);

    const [acceptedInvite] = await db
      .select()
      .from(invitation)
      .where(eq(invitation.id, invite.id));
    expect(acceptedInvite.status).toBe("accepted");

    await invited.context.close();
  });

  test("already signed-in invited account can accept from the invite page", async ({
    browser,
    db,
    page,
  }) => {
    const existingEmail = `signed-in-invite-${run}@example.com`;
    const existingName = `Signed In Invite ${run}`;
    const existing = await createStandaloneAccount(
      browser,
      db,
      existingEmail,
      existingName,
      existingPassword
    );
    await existing.context.close();

    await page.goto("/settings");
    const response = await apiCall<{ error?: string }>(page, "/api/team/invitations", {
      method: "POST",
      body: { email: existingEmail, presetKey: "view_only" },
    });
    expect(response.status).toBe(200);

    const [invite] = await db
      .select()
      .from(invitation)
      .where(and(eq(invitation.organizationId, TEST_ORG_ID), eq(invitation.email, existingEmail)));
    expect(invite).toBeTruthy();

    const signedIn = await signInAsExistingUser(
      browser,
      existingEmail,
      existingPassword,
      "/org-setup"
    );
    await signedIn.page.goto(`/accept-invitation?id=${invite.id}`);
    await expect(signedIn.page.getByText(`Signed in as ${existingEmail}.`)).toBeVisible();
    await signedIn.page.getByRole("button", { name: "Join workspace" }).click();
    await signedIn.page.waitForURL("**/settings", { timeout: 15_000 });

    const [existingUser] = await db.select().from(user).where(eq(user.email, existingEmail));
    expect(existingUser).toBeTruthy();

    const [existingMember] = await db
      .select()
      .from(member)
      .where(and(eq(member.organizationId, TEST_ORG_ID), eq(member.userId, existingUser.id)));
    expectRoleIncludes(existingMember.role, [
      "access:matrix",
      "member",
      "inventory:read",
      "sales:read",
      "manufacturing:read",
      "purchasing:read",
    ]);

    await signedIn.context.close();
  });

  test("org setup sends invited users back to their pending invite", async ({
    browser,
    db,
    page,
  }) => {
    const existingEmail = `org-setup-invite-${run}@example.com`;
    const existingName = `Org Setup Invite ${run}`;
    const existing = await createStandaloneAccount(
      browser,
      db,
      existingEmail,
      existingName,
      existingPassword
    );
    await existing.context.close();

    await page.goto("/settings");
    const response = await apiCall<{ error?: string }>(page, "/api/team/invitations", {
      method: "POST",
      body: { email: existingEmail, presetKey: "view_only" },
    });
    expect(response.status).toBe(200);

    const [invite] = await db
      .select()
      .from(invitation)
      .where(and(eq(invitation.organizationId, TEST_ORG_ID), eq(invitation.email, existingEmail)));
    expect(invite).toBeTruthy();

    const signedIn = await signInAsExistingUser(
      browser,
      existingEmail,
      existingPassword,
      "/accept-invitation"
    );
    await expect(signedIn.page).toHaveURL(new RegExp(`/accept-invitation\\?id=${invite.id}$`));
    await expect(signedIn.page.getByLabel("Organization name")).toHaveCount(0);
    await expect(signedIn.page.getByText(`Signed in as ${existingEmail}.`)).toBeVisible();

    await signedIn.page.getByRole("button", { name: "Join workspace" }).click();
    await signedIn.page.waitForURL("**/settings", { timeout: 15_000 });

    const [existingUser] = await db.select().from(user).where(eq(user.email, existingEmail));
    expect(existingUser).toBeTruthy();

    const [existingMember] = await db
      .select()
      .from(member)
      .where(and(eq(member.organizationId, TEST_ORG_ID), eq(member.userId, existingUser.id)));
    expectRoleIncludes(existingMember.role, [
      "access:matrix",
      "member",
      "inventory:read",
      "sales:read",
      "manufacturing:read",
      "purchasing:read",
    ]);

    await signedIn.context.close();
  });

  test("sales operator invite applies the preset access on join", async ({ browser, db }) => {
    const accepted = await acceptInviteAsNewUser(
      browser,
      db,
      memberInvitationId,
      memberEmail,
      memberName,
      memberPassword
    );

    await expect(accepted.page).toHaveURL(/\/(settings|sales\/orders)$/);
    await expectModuleLinkVisible(accepted.page, "Sales", "/sales/orders");
    await expectModuleLinkVisible(accepted.page, "Inventory", "/inventory/products");

    const [memberUser] = await db.select().from(user).where(eq(user.email, memberEmail));
    expect(memberUser).toBeTruthy();
    memberUserId = memberUser.id;

    const [memberRow] = await db
      .select()
      .from(member)
      .where(and(eq(member.organizationId, TEST_ORG_ID), eq(member.userId, memberUser.id)));
    expectRoleIncludes(memberRow.role, [
      "access:matrix",
      "member",
      "inventory:read",
      "sales:operate",
      "manufacturing:read",
      "purchasing:read",
    ]);
    memberMemberId = memberRow.id;

    const blockedManufacturing = await apiCall<{ error?: string }>(
      accepted.page,
      `/api/sales-orders/${BLOCKED_ROUTE_ID}/manufacturing-orders`,
      {
        method: "POST",
        body: {
          plannedDate: null,
          notes: null,
        },
      }
    );
    expect(blockedManufacturing.status).toBe(403);

    const salesRead = await apiCall<{ error?: string }>(accepted.page, "/api/sales-orders", {
      method: "POST",
      body: {
        customerId: BLOCKED_ROUTE_ID,
        status: "open",
        requestedDate: null,
        notes: null,
        lines: [],
        confirmOversell: false,
      },
    });
    expect(salesRead.status).not.toBe(403);

    await accepted.context.close();
  });

  test("settings admin can access team settings but cannot grant team management", async ({
    browser,
    db,
  }) => {
    const accepted = await acceptInviteAsNewUser(
      browser,
      db,
      adminInvitationId,
      adminEmail,
      adminName,
      adminPassword
    );

    const [adminUser] = await db.select().from(user).where(eq(user.email, adminEmail));
    expect(adminUser).toBeTruthy();

    const [adminRow] = await db
      .select()
      .from(member)
      .where(and(eq(member.organizationId, TEST_ORG_ID), eq(member.userId, adminUser.id)));
    expectRoleIncludes(adminRow.role, [
      "access:matrix",
      "member",
      "inventory:admin",
      "sales:admin",
      "manufacturing:admin",
      "purchasing:admin",
      "settings:admin",
    ]);
    await accepted.context.close();

    const { context, page } = await signInAsExistingUser(
      browser,
      adminEmail,
      adminPassword,
      "/sales/orders"
    );
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();

    await page.getByRole("button", { name: "Invite member" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Email")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    const allowedInvite = await apiCall<{ error?: string }>(page, "/api/team/invitations", {
      method: "POST",
      body: {
        email: `settings-admin-invite-${run}@example.com`,
        presetKey: "view_only",
      },
    });
    expect(allowedInvite.status).toBe(200);

    const blockedAdminPatch = await apiCall<{ error?: string }>(
      page,
      `/api/team/members/${memberMemberId}`,
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
    expect(blockedAdminPatch.status).toBe(403);

    await context.close();
  });

  test("owner can customize member access from the team panel", async ({ db, page }) => {
    await updateMemberAccess(page, {
      inventory: "read",
      sales: "operate",
      manufacturing: "read",
      purchasing: "read",
      settings: "none",
    });

    const [updatedMember] = await db
      .select()
      .from(member)
      .where(eq(member.id, memberMemberId));
    expectRoleIncludes(updatedMember.role, [
      "access:matrix",
      "member",
      "inventory:read",
      "sales:operate",
      "manufacturing:read",
      "purchasing:read",
    ]);

  });

  test("member with inventory operate can create materials and unlocked products", async ({
    browser,
    db,
    page,
  }) => {
    const [unit] = await db
      .select({ id: unitDefinitions.id })
      .from(unitDefinitions)
      .where(eq(unitDefinitions.organizationId, TEST_ORG_ID))
      .limit(1);

    expect(unit).toBeTruthy();

    await updateMemberAccess(page, {
      inventory: "operate",
      sales: "none",
      manufacturing: "none",
      purchasing: "none",
      settings: "none",
    });

    const { context, page: memberPage } = await signInAsExistingUser(
      browser,
      memberEmail,
      memberPassword,
      "/inventory/materials"
    );

    await expectModuleLinkVisible(memberPage, "Inventory", "/inventory/products");
    await expectModuleHidden(memberPage, "Sales", "/sales/orders");

    await memberPage.goto("/inventory/stocktakes/new");
    await expect(memberPage).toHaveURL(/\/inventory\/stocktakes\/new$/);

    await memberPage.goto("/inventory/materials/new");
    await expect(memberPage).toHaveURL(/\/inventory\/materials\/new$/);

    const materialCreate = await apiCall<{ id?: string; error?: string }>(
      memberPage,
      "/api/items",
      {
        method: "POST",
        body: {
          name: `Operate Material ${run}`,
          itemType: "material",
          unitDefinitionId: unit.id,
          purchaseUnitDefinitionId: null,
          purchaseToStockFactor: null,
          sku: null,
          category: null,
          defaultPurchasePrice: null,
          defaultSellingPrice: null,
          description: null,
          safetyStock: "0",
          stock: "0",
        },
      }
    );
    expect(materialCreate.status).toBe(201);
    expect(materialCreate.body?.id).toBeTruthy();

    await memberPage.goto("/inventory/products/new");
    await expect(memberPage).toHaveURL(/\/inventory\/products\/new$/);

    const unlockedProductMutation = await apiCall<{ id?: string; error?: string }>(
      memberPage,
      "/api/items",
      {
        method: "POST",
        body: {
          name: `Unlocked Product ${run}`,
          itemType: "product",
          unitDefinitionId: unit.id,
          purchaseUnitDefinitionId: null,
          purchaseToStockFactor: null,
          sku: null,
          category: null,
          defaultPurchasePrice: null,
          defaultSellingPrice: null,
          description: null,
          safetyStock: "0",
          stock: "0",
          bom: [
            {
              componentId: materialCreate.body?.id,
              quantity: "1",
            },
          ],
        },
      }
    );
    expect(unlockedProductMutation.status).toBe(201);
    expect(unlockedProductMutation.body?.id).toBeTruthy();
    unlockedProductId = unlockedProductMutation.body!.id!;

    await context.close();
  });

  test("member with manufacturing operate can create orders and view BOMs but cannot edit products", async ({
    browser,
    db,
    page,
  }) => {
    let productId = unlockedProductId;
    if (!productId) {
      const [product] = await db
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.organizationId, TEST_ORG_ID), eq(items.itemType, "product")))
        .limit(1);
      productId = product?.id ?? "";
    }
    expect(productId).toBeTruthy();

    await updateMemberAccess(page, {
      inventory: "read",
      sales: "none",
      manufacturing: "operate",
      purchasing: "none",
      settings: "none",
    });

    const { context, page: memberPage } = await signInAsExistingUser(
      browser,
      memberEmail,
      memberPassword,
      "/inventory/materials"
    );

    await memberPage.goto(`/inventory/products/${productId}?tab=recipe`);
    await expect(memberPage).toHaveURL(new RegExp(`/inventory/products/${productId}\\?tab=recipe$`));
    await expect(memberPage.getByText("Recipe / Bill of Materials")).toBeVisible();
    await expect(memberPage.getByRole("link", { name: "Edit" })).toHaveCount(0);

    await memberPage.goto(`/inventory/products/${productId}/edit`);
    await memberPage.waitForURL("**/inventory/materials");

    await context.close();
  });

  test("locked BOMs require inventory admin to view or edit recipe details", async ({
    browser,
    db,
    page,
  }) => {
    const [unit] = await db
      .select({ id: unitDefinitions.id })
      .from(unitDefinitions)
      .where(eq(unitDefinitions.organizationId, TEST_ORG_ID))
      .limit(1);

    expect(unit).toBeTruthy();

    const lockMaterial = await ownerApiCall<{ id?: string }>(page, "/api/items", {
      method: "POST",
      body: {
        name: `Locked Material ${run}`,
        itemType: "material",
        unitDefinitionId: unit.id,
        purchaseUnitDefinitionId: null,
        purchaseToStockFactor: null,
        sku: null,
        category: null,
        defaultPurchasePrice: null,
        defaultSellingPrice: null,
        description: null,
        safetyStock: "0",
        stock: "0",
      },
    });
    expect(lockMaterial.status).toBe(201);
    expect(lockMaterial.body?.id).toBeTruthy();
    const lockMaterialId = lockMaterial.body!.id;

    const lockedProduct = await ownerApiCall<{ id?: string }>(page, "/api/items", {
      method: "POST",
      body: {
        name: `Locked Product ${run}`,
        itemType: "product",
        unitDefinitionId: unit.id,
        purchaseUnitDefinitionId: null,
        purchaseToStockFactor: null,
        sku: null,
        category: null,
        defaultPurchasePrice: null,
        defaultSellingPrice: null,
        description: null,
        safetyStock: "0",
        stock: "0",
        bom: [
          {
            componentId: lockMaterial.body?.id,
            quantity: "2",
          },
        ],
      },
    });
    expect(lockedProduct.status).toBe(201);
    expect(lockedProduct.body?.id).toBeTruthy();
    const lockedProductId = lockedProduct.body!.id;

    const lockResponse = await ownerApiCall<{ bomLocked?: boolean; error?: string }>(
      page,
      `/api/items/${lockedProductId}/bom-lock`,
      {
        method: "POST",
        body: { locked: true },
      }
    );
    expect(lockResponse.status).toBe(200);
    expect(lockResponse.body?.bomLocked).toBe(true);

    await updateMemberAccess(page, {
      inventory: "read",
      sales: "none",
      manufacturing: "none",
      purchasing: "none",
      settings: "none",
    });

    const { context: readContext, page: readPage } = await signInAsExistingUser(
      browser,
      memberEmail,
      memberPassword,
      "/inventory/materials"
    );

    await readPage.goto(`/inventory/materials/${lockMaterialId}`);
    await expect(readPage.getByText("Not used in any current product recipes.")).toBeVisible();
    await expect(readPage.getByRole("link", { name: `Locked Product ${run}` })).toHaveCount(0);

    const hiddenUsedInResponse = await apiCall<{ parents?: Array<{ id: string }> }>(
      readPage,
      `/api/items/${lockMaterialId}/used-in`
    );
    expect(hiddenUsedInResponse.status).toBe(200);
    expect(hiddenUsedInResponse.body?.parents ?? []).toEqual([]);

    await readContext.close();

    await updateMemberAccess(page, {
      inventory: "operate",
      sales: "none",
      manufacturing: "none",
      purchasing: "none",
      settings: "none",
    });

    const { context, page: memberPage } = await signInAsExistingUser(
      browser,
      memberEmail,
      memberPassword,
      "/inventory/materials"
    );

    await memberPage.goto(`/inventory/products/${lockedProductId}?tab=recipe`);
    await expect(memberPage.getByLabel("Locked recipe")).toBeVisible();
    await expect(
      memberPage.getByText("This recipe is locked. Inventory or manufacturing admin access is required")
    ).toBeVisible();
    await expect(memberPage.getByText(`Locked Material ${run}`)).toHaveCount(0);
    await expect(memberPage.getByRole("link", { name: "Edit" })).toHaveCount(0);

    await memberPage.goto(`/inventory/products/${lockedProductId}/edit`);
    await memberPage.waitForURL(`**/inventory/products/${lockedProductId}`);

    const blockedLockedProductMutation = await apiCall<{ error?: string }>(
      memberPage,
      `/api/items/${lockedProductId}`,
      {
        method: "PUT",
        body: {
          purchaseUnitDefinitionId: null,
          purchaseToStockFactor: null,
          sku: null,
          category: null,
          description: "blocked locked edit",
          defaultPurchasePrice: null,
          defaultSellingPrice: null,
          safetyStock: "0",
          stock: "0",
          bom: [
            {
              componentId: lockMaterial.body?.id,
              quantity: "3",
            },
          ],
        },
      }
    );
    expect(blockedLockedProductMutation.status).toBe(403);

    await context.close();

    await updateMemberAccess(page, {
      inventory: "admin",
      sales: "none",
      manufacturing: "none",
      purchasing: "none",
      settings: "none",
    });

    const { context: adminContext, page: adminPage } = await signInAsExistingUser(
      browser,
      memberEmail,
      memberPassword,
      "/inventory/materials"
    );

    await adminPage.goto(`/inventory/products/${lockedProductId}?tab=recipe`);
    await expect(adminPage.getByText(`Locked Material ${run}`)).toBeVisible();
    await expect(adminPage.getByRole("link", { name: "Edit" })).toBeVisible();
    await adminPage.getByRole("link", { name: "Edit" }).click();
    await expect(adminPage).toHaveURL(
      new RegExp(`/inventory/products/${lockedProductId}/edit$`)
    );
    await expect(adminPage.getByRole("button", { name: "Unlock recipe" })).toBeVisible();

    await adminContext.close();
  });

  test("member with sales operate can access sales but not inventory or team", async ({
    browser,
    page,
  }) => {
    await updateMemberAccess(page, {
      inventory: "none",
      sales: "operate",
      manufacturing: "none",
      purchasing: "none",
      settings: "none",
    });

    const { context, page: memberPage } = await signInAsExistingUser(
      browser,
      memberEmail,
      memberPassword,
      "/sales/orders"
    );

    await expectModuleLinkVisible(memberPage, "Sales", "/sales/orders");
    await expectModuleHidden(memberPage, "Inventory", "/inventory/products");

    await memberPage.goto("/sales/orders");
    await expect(memberPage).toHaveURL(/\/sales\/orders$/);
    await expect(memberPage.getByLabel("Search orders")).toBeVisible();

    await memberPage.goto("/inventory/products", { waitUntil: "commit" });
    await memberPage.waitForURL("**/sales/orders");

    await memberPage.goto("/sales/pricing", { waitUntil: "commit" });
    await memberPage.waitForURL("**/sales/orders");

    await memberPage.goto("/sales/pricing/schedules/new", { waitUntil: "commit" });
    await memberPage.waitForURL("**/sales/orders");

    const allowedSalesMutation = await apiCall<{ error?: string; errors?: Record<string, string[]> }>(
      memberPage,
      "/api/customers",
      { method: "POST", body: {} }
    );
    expect(allowedSalesMutation.status).not.toBe(403);

    const blockedInventoryMutation = await apiCall<{ error?: string }>(memberPage, "/api/items", {
      method: "POST",
      body: {},
    });
    expect(blockedInventoryMutation.status).toBe(403);

    const blockedManufacturingMutation = await apiCall<{ error?: string }>(
      memberPage,
      "/api/manufacturing-orders",
      { method: "POST", body: {} }
    );
    expect(blockedManufacturingMutation.status).toBe(403);

    const blockedPurchasingMutation = await apiCall<{ error?: string }>(
      memberPage,
      `/api/purchase-orders/${BLOCKED_ROUTE_ID}/receive`,
      { method: "POST", body: {} }
    );
    expect(blockedPurchasingMutation.status).toBe(403);

    const blockedPricingMutation = await apiCall<{ error?: string }>(memberPage, "/api/customer-categories", {
      method: "POST",
      body: { name: `Blocked category ${run}` },
    });
    expect(blockedPricingMutation.status).toBe(403);

    await context.close();
  });

  test("member with purchasing operate can access purchasing screens but not other modules", async ({
    browser,
    page,
  }) => {
    await updateMemberAccess(page, {
      inventory: "none",
      sales: "none",
      manufacturing: "none",
      purchasing: "operate",
      settings: "none",
    });

    const { context, page: memberPage } = await signInAsExistingUser(
      browser,
      memberEmail,
      memberPassword,
      "/purchasing/orders"
    );

    await expectModuleLinkVisible(memberPage, "Purchasing", "/purchasing/orders");
    await expectModuleHidden(memberPage, "Inventory", "/inventory/products");
    await expectModuleHidden(memberPage, "Sales", "/sales/orders");

    await memberPage.goto("/purchasing/orders/new");
    await expect(memberPage).toHaveURL(/\/purchasing\/orders\/new$/);

    await memberPage.goto("/purchasing/suppliers/new");
    await expect(memberPage).toHaveURL(/\/purchasing\/suppliers\/new$/);

    await memberPage.goto("/sales/orders", { waitUntil: "commit" });
    await memberPage.waitForURL("**/purchasing/orders");

    const blockedSalesMutation = await apiCall<{ error?: string }>(memberPage, "/api/sales-orders", {
      method: "POST",
      body: {},
    });
    expect(blockedSalesMutation.status).toBe(403);

    await context.close();
  });

  test("owner can remove a member without deleting the underlying auth account", async ({
    db,
    page,
  }) => {
    const removeResponse = await ownerApiCall<{ error?: string }>(
      page,
      `/api/team/members/${memberMemberId}`,
      { method: "DELETE" }
    );
    expect(removeResponse.status).toBe(200);

    const memberRows = await db
      .select()
      .from(member)
      .where(eq(member.id, memberMemberId));
    expect(memberRows).toHaveLength(0);

    const [persistedUser] = await db.select().from(user).where(eq(user.id, memberUserId));
    expect(persistedUser.email).toBe(memberEmail);
  });
});
