import fs from "node:fs";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { expect, test } from "./fixtures";
import {
  invitation,
  member,
  organization,
  user,
} from "../../lib/db/schema";

const env = JSON.parse(fs.readFileSync("test/.test-env.json", "utf-8"));
const SESSION_COOKIE = env.TEST_SESSION_COOKIE;
const TEST_ORG_ID = env.TEST_ORG_ID;
const BASE_URL = env.TEST_BASE_URL ?? "http://localhost:3000";

function parseCookie(raw: string) {
  const [name, ...rest] = raw.split("=");
  return { name, value: rest.join("=") };
}

async function addSessionCookie(context: BrowserContext, rawCookie: string) {
  const { name, value } = parseCookie(rawCookie);
  await context.addCookies([
    { name, value, domain: "localhost", path: "/" },
  ]);
}

async function createFreshPage(browser: Browser) {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  return { context, page };
}

async function signInAsExistingUser(
  browser: Browser,
  email: string,
  password: string
) {
  const { context, page } = await createFreshPage(browser);
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();
  await page.waitForURL("**/inventory/products");
  return { context, page };
}

async function acceptInviteAsNewUser(
  browser: Browser,
  invitationId: string,
  email: string,
  name: string,
  password: string
) {
  const { context, page } = await createFreshPage(browser);
  await page.goto(`/accept-invitation?id=${invitationId}`);
  await expect(page.getByText(`This invite is for ${email}`)).toBeVisible();
  await page.getByLabel("Full Name").fill(name);
  await page.getByLabel(/^Password$/).fill(password);
  await page.getByLabel(/^Confirm Password$/).fill(password);
  await page.getByRole("button", { name: "Create Account and Join" }).click();
  await page.waitForURL("**/inventory/products");
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
      const response = await fetch(path, {
        method: method ?? "GET",
        headers: body ? { "Content-Type": "application/json" } : undefined,
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

test.beforeEach(async ({ context }) => {
  await addSessionCookie(context, SESSION_COOKIE);
});

test.describe("Team management and invite flow", () => {
  test.describe.configure({ mode: "serial" });

  const run = Date.now();
  const operatorEmail = `operator-${run}@example.com`;
  const viewerEmail = `viewer-${run}@example.com`;
  const adminEmail = `admin-${run}@example.com`;
  const operatorPassword = "OperatorPassword123!";
  const viewerPassword = "ViewerPassword123!";
  const adminPassword = "AdminPassword123!";
  const operatorName = `Operator ${run}`;
  const viewerName = `Viewer ${run}`;
  const adminName = `Admin ${run}`;
  const orgOwnerEmail = `owner-${run}@example.com`;
  const orgOwnerPassword = "OwnerPassword123!";

  let operatorInvitationId = "";
  let viewerInvitationId = "";
  let adminInvitationId = "";
  let operatorMemberId = "";
  let adminMemberId = "";
  let operatorUserId = "";

  test("public sign-up and org creation still work for a first owner", async ({ browser, db }) => {
    const { context, page } = await createFreshPage(browser);

    await page.goto("/sign-up");
    await page.getByLabel("Full Name").fill(`Fresh Owner ${run}`);
    await page.getByLabel("Email").fill(orgOwnerEmail);
    await page.getByLabel(/^Password$/).fill(orgOwnerPassword);
    await page.getByLabel(/^Confirm Password$/).fill(orgOwnerPassword);
    await page.getByRole("button", { name: "Create Account" }).click();
    await page.waitForURL("**/org-setup");

    const orgName = `Fresh Org ${run}`;
    await page.getByLabel("Organization name").fill(orgName);
    await page.getByRole("button", { name: "Create Organization" }).click();
    await page.waitForURL("**/inventory/products");

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
      .where(
        and(
          eq(member.organizationId, freshOrg.id),
          eq(member.userId, ownerUser.id)
        )
      );
    expect(ownerMember.role).toBe("owner");

    await context.close();
  });

  test("owner invites operator, viewer, and admin from Settings > Team", async ({ page, db }) => {
    await page.goto("/settings/team");
    await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();

    const inviteMember = async (email: string, role: "operator" | "viewer" | "admin") => {
      await page.getByRole("button", { name: "Invite Member" }).click();
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Role").click();
      await page.getByRole("option", { name: new RegExp(role, "i") }).click();
      const inviteResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/team/invitations") &&
          response.request().method() === "POST"
      );
      await page.getByRole("button", { name: "Send Invite" }).click();
      await inviteResponse;
      await expect(page.getByRole("dialog")).toHaveCount(0);
    };

    await inviteMember(operatorEmail, "operator");
    await inviteMember(viewerEmail, "viewer");
    await inviteMember(adminEmail, "admin");

    const [operatorInvite] = await db
      .select()
      .from(invitation)
      .where(
        and(
          eq(invitation.organizationId, TEST_ORG_ID),
          eq(invitation.email, operatorEmail)
        )
      );
    const [viewerInvite] = await db
      .select()
      .from(invitation)
      .where(
        and(
          eq(invitation.organizationId, TEST_ORG_ID),
          eq(invitation.email, viewerEmail)
        )
      );
    const [adminInvite] = await db
      .select()
      .from(invitation)
      .where(
        and(
          eq(invitation.organizationId, TEST_ORG_ID),
          eq(invitation.email, adminEmail)
        )
      );

    expect(operatorInvite.role).toBe("operator");
    expect(viewerInvite.role).toBe("viewer");
    expect(adminInvite.role).toBe("admin");

    await page.reload();
    await expect(page.getByRole("row", { name: new RegExp(operatorEmail) })).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(viewerEmail) })).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(adminEmail) })).toBeVisible();

    operatorInvitationId = operatorInvite.id;
    viewerInvitationId = viewerInvite.id;
    adminInvitationId = adminInvite.id;

    const operatorRow = page.getByRole("row", { name: new RegExp(operatorEmail) });
    const resendResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/team/invitations/${operatorInvitationId}/resend`) &&
        response.request().method() === "POST"
    );
    await operatorRow.getByRole("button", { name: "Resend" }).click();
    await resendResponse;

    const viewerRow = page.getByRole("row", { name: new RegExp(viewerEmail) });
    const cancelResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/team/invitations/${viewerInvitationId}`) &&
        response.request().method() === "DELETE"
    );
    await viewerRow.getByRole("button", { name: "Cancel" }).click();
    await cancelResponse;

    const [cancelledInvite] = await db
      .select()
      .from(invitation)
      .where(eq(invitation.id, viewerInvitationId));
    expect(cancelledInvite.status).toBe("canceled");

    await inviteMember(viewerEmail, "viewer");

    const pendingViewerInvites = await db
      .select()
      .from(invitation)
      .where(
        and(
          eq(invitation.organizationId, TEST_ORG_ID),
          eq(invitation.email, viewerEmail),
          eq(invitation.status, "pending")
        )
      );
    expect(pendingViewerInvites).toHaveLength(1);
    viewerInvitationId = pendingViewerInvites[0].id;
  });

  test("operator accepts invite and becomes an org member", async ({ browser, db }) => {
    const accepted = await acceptInviteAsNewUser(
      browser,
      operatorInvitationId,
      operatorEmail,
      operatorName,
      operatorPassword
    );

    const [operatorUser] = await db.select().from(user).where(eq(user.email, operatorEmail));
    expect(operatorUser).toBeTruthy();
    operatorUserId = operatorUser.id;

    const [operatorMember] = await db
      .select()
      .from(member)
      .where(
        and(
          eq(member.organizationId, TEST_ORG_ID),
          eq(member.userId, operatorUser.id)
        )
      );
    expect(operatorMember.role).toBe("operator");
    operatorMemberId = operatorMember.id;

    await accepted.context.close();
  });

  test("viewer accepts invite and becomes an org member", async ({ browser, db }) => {
    const accepted = await acceptInviteAsNewUser(
      browser,
      viewerInvitationId,
      viewerEmail,
      viewerName,
      viewerPassword
    );

    const [viewerUser] = await db.select().from(user).where(eq(user.email, viewerEmail));
    expect(viewerUser).toBeTruthy();

    const [viewerMember] = await db
      .select()
      .from(member)
      .where(
        and(
          eq(member.organizationId, TEST_ORG_ID),
          eq(member.userId, viewerUser.id)
        )
      );
    expect(viewerMember.role).toBe("viewer");

    await accepted.context.close();
  });

  test("admin accepts invite and becomes an org member", async ({ browser, db }) => {
    const accepted = await acceptInviteAsNewUser(
      browser,
      adminInvitationId,
      adminEmail,
      adminName,
      adminPassword
    );

    const [adminUser] = await db.select().from(user).where(eq(user.email, adminEmail));
    expect(adminUser).toBeTruthy();

    const [adminMember] = await db
      .select()
      .from(member)
      .where(
        and(
          eq(member.organizationId, TEST_ORG_ID),
          eq(member.userId, adminUser.id)
        )
      );
    expect(adminMember.role).toBe("admin");
    adminMemberId = adminMember.id;

    await accepted.context.close();
  });

  test("admin can access team settings but cannot manage admin roles", async ({ browser }) => {
    const { context, page } = await signInAsExistingUser(
      browser,
      adminEmail,
      adminPassword
    );

    await page.goto("/settings/team");
    await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();

    await page.getByRole("button", { name: "Invite Member" }).click();
    await page.getByLabel("Role").click();
    await expect(page.getByRole("option", { name: "Operator" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Viewer" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Admin" })).toHaveCount(0);
    await page.goto("/settings/team");
    await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();

    const inviteAttempt = await apiCall<{ error?: string }>(page, "/api/team/invitations", {
      method: "POST",
      body: { email: `blocked-admin-${run}@example.com`, role: "admin" },
    });
    expect(inviteAttempt.status).toBe(403);
    expect(inviteAttempt.body?.error).toContain("assign");

    const demoteAttempt = await apiCall<{ error?: string }>(
      page,
      `/api/team/members/${adminMemberId}`,
      {
        method: "PATCH",
        body: { role: "viewer" },
      }
    );
    expect(demoteAttempt.status).toBe(403);
    expect(demoteAttempt.body?.error).toContain("manage");

    await context.close();
  });

  test("operator only sees inventory and manufacturing and is blocked from sales and purchasing", async ({ browser }) => {
    const { context, page } = await signInAsExistingUser(
      browser,
      operatorEmail,
      operatorPassword
    );

    await page.goto("/inventory/products");
    await expect(page.getByText("Inventory")).toBeVisible();
    await expect(page.locator('a[href="/sales/orders"]')).toHaveCount(0);
    await expect(page.locator('a[href="/purchasing/orders"]')).toHaveCount(0);
    await expect(page.locator('a[href="/settings/team"]')).toHaveCount(0);

    await page.goto("/sales/orders");
    await page.waitForURL("**/inventory/products");

    await page.goto("/purchasing/orders");
    await page.waitForURL("**/inventory/products");

    const blockedMutation = await apiCall<{ error?: string }>(
      page,
      "/api/sales-orders",
      { method: "POST", body: {} }
    );
    expect(blockedMutation.status).toBe(403);

    await context.close();
  });

  test("viewer can read all modules but cannot mutate anything", async ({ browser }) => {
    const { context, page } = await signInAsExistingUser(
      browser,
      viewerEmail,
      viewerPassword
    );

    await page.goto("/sales/orders");
    await expect(page.getByText("Sales")).toBeVisible();

    await page.goto("/purchasing/orders");
    await expect(page.getByText("Purchasing")).toBeVisible();

    await page.goto("/manufacturing/orders");
    await expect(page.getByText("Manufacturing")).toBeVisible();

    const blockedItemMutation = await apiCall<{ error?: string }>(
      page,
      "/api/items",
      { method: "POST", body: {} }
    );
    expect(blockedItemMutation.status).toBe(403);

    const blockedManufacturingMutation = await apiCall<{ error?: string }>(
      page,
      "/api/manufacturing-orders",
      { method: "POST", body: {} }
    );
    expect(blockedManufacturingMutation.status).toBe(403);

    await expect(page.locator('a[href="/settings/team"]')).toHaveCount(0);

    await context.close();
  });

  test("owner can remove a member without deleting the underlying auth account", async ({ page, db }) => {
    await page.goto("/settings/team");
    const operatorRow = page.getByRole("row", { name: new RegExp(operatorEmail) });
    await operatorRow.getByRole("button", { name: `Manage ${operatorName}` }).click();
    const removeResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/team/members/${operatorMemberId}`) &&
        response.request().method() === "DELETE"
    );
    await page.getByRole("menuitem", { name: "Remove member" }).click();
    await removeResponse;
    await expect(operatorRow).toHaveCount(0);

    const memberRows = await db
      .select()
      .from(member)
      .where(eq(member.id, operatorMemberId));
    expect(memberRows).toHaveLength(0);

    const [persistedUser] = await db.select().from(user).where(eq(user.id, operatorUserId));
    expect(persistedUser.email).toBe(operatorEmail);
  });
});
