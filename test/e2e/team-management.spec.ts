import fs from "node:fs";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { expect, test } from "./fixtures";
import {
  invitation,
  items,
  member,
  organization,
  unitDefinitions,
  user,
} from "../../lib/db/schema";

const env = JSON.parse(fs.readFileSync("test/.test-env.json", "utf-8"));
const SESSION_COOKIE = env.TEST_SESSION_COOKIE;
const TEST_ORG_ID = env.TEST_ORG_ID;
const BASE_URL = env.TEST_BASE_URL ?? "http://localhost:3000";
const BLOCKED_ROUTE_ID = "11111111-1111-1111-1111-111111111111";
const MODULE_ORDER = ["inventory", "sales", "manufacturing", "purchasing"] as const;

function parseCookie(raw: string) {
  const [name, ...rest] = raw.split("=");
  return { name, value: rest.join("=") };
}

function pendingInviteCard(page: Page, email: string) {
  return page
    .getByText(email, { exact: true })
    .locator("xpath=ancestor::div[2]");
}

function memberRowByEmail(page: Page, email: string) {
  return page
    .getByText(email, { exact: true })
    .locator("xpath=ancestor::tr[1]");
}

async function setMatrixAccess(
  page: Page,
  email: string,
  module: (typeof MODULE_ORDER)[number],
  target: "none" | "read" | "operate" | "admin"
) {
  const row = memberRowByEmail(page, email);
  const moduleIndex = MODULE_ORDER.indexOf(module);
  const cellButton = row.locator("td").nth(moduleIndex + 1).getByRole("button");

  await expect(cellButton).toBeVisible();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const currentLabel = await cellButton.getAttribute("aria-label");
    if (currentLabel?.toLowerCase().includes(target)) {
      return;
    }

    const updateResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/team/members/") &&
        response.request().method() === "PATCH"
    );
    await cellButton.click();
    await updateResponse;
    await expect(cellButton).not.toHaveAttribute("aria-label", currentLabel ?? "", {
      timeout: 15_000,
    });
  }

  throw new Error(`Failed to set ${module} access to ${target} for ${email}`);
}

async function addSessionCookie(context: BrowserContext, rawCookie: string) {
  const { name, value } = parseCookie(rawCookie);
  await context.addCookies([{ name, value, domain: "localhost", path: "/" }]);
}

async function createFreshPage(browser: Browser) {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  return { context, page };
}

async function signInAsExistingUser(
  browser: Browser,
  email: string,
  password: string,
  expectedPath = "/settings"
) {
  const { context, page } = await createFreshPage(browser);
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();
  await page.waitForURL(`**${expectedPath}`, { timeout: 15_000 });
  return { context, page };
}

async function acceptInviteAsNewUser(
  browser: Browser,
  invitationId: string,
  email: string,
  name: string,
  password: string,
  expectedPath = "/settings"
) {
  const { context, page } = await createFreshPage(browser);
  await page.goto(`/accept-invitation?id=${invitationId}`);
  await expect(page.getByText(`This invite is for ${email}`)).toBeVisible();
  await page.getByLabel("Full Name").fill(name);
  await page.getByLabel(/^Password$/).fill(password);
  await page.getByLabel(/^Confirm Password$/).fill(password);
  await page.locator("form").getByRole("button", { name: "Create Account" }).click();
  await page.waitForURL(`**${expectedPath}`, { timeout: 15_000 });
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
    async ({ path, method, body, baseUrl }) => {
      const url = new URL(path, baseUrl).toString();
      const response = await fetch(url, {
        method: method ?? "GET",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      return {
        status: response.status,
        body: await response.json().catch(() => null),
      };
    },
    { path, method: options.method, body: options.body, baseUrl: BASE_URL }
  );
}

function expectRoleIncludes(storedRole: string, expectedRoles: string[]) {
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
  const memberPassword = "MemberPassword123!";
  const adminPassword = "AdminPassword123!";
  const memberName = `Member ${run}`;
  const adminName = `Admin ${run}`;
  const orgOwnerEmail = `owner-${run}@example.com`;
  const orgOwnerPassword = "OwnerPassword123!";

  let memberInvitationId = "";
  let adminInvitationId = "";
  let memberMemberId = "";
  let adminMemberId = "";
  let memberUserId = "";

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
    if (!page.url().startsWith(BASE_URL)) {
      await page.goto("/settings");
    }

    const response = await apiCall<{ error?: string }>(
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
      .where(and(eq(member.organizationId, freshOrg.id), eq(member.userId, ownerUser.id)));
    expect(ownerMember.role).toBe("owner");

    await context.close();
  });

  test("owner invites users from Settings > Team", async ({ page, db }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();

    const inviteMember = async (email: string) => {
      await page.getByRole("button", { name: "Invite member" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Email").fill(email);
      const inviteResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/team/invitations") &&
          response.request().method() === "POST"
      );
      await page.getByRole("button", { name: "Send invite" }).click();
      await inviteResponse;
      await expect(page.getByRole("dialog")).toHaveCount(0);
    };

    await inviteMember(memberEmail);
    await inviteMember(adminEmail);

    const [memberInvite] = await db
      .select()
      .from(invitation)
      .where(and(eq(invitation.organizationId, TEST_ORG_ID), eq(invitation.email, memberEmail)));
    const [adminInvite] = await db
      .select()
      .from(invitation)
      .where(and(eq(invitation.organizationId, TEST_ORG_ID), eq(invitation.email, adminEmail)));

    expectRoleIncludes(memberInvite.role, ["access:matrix", "member"]);
    expectRoleIncludes(adminInvite.role, ["access:matrix", "member"]);

    await page.reload();
    await expect(pendingInviteCard(page, memberEmail)).toBeVisible();
    await expect(pendingInviteCard(page, adminEmail)).toBeVisible();

    memberInvitationId = memberInvite.id;
    adminInvitationId = adminInvite.id;
  });

  test("logged-in owner can log out from invite mismatch and continue in auth form", async ({
    page,
    db,
  }) => {
    let inviteId = memberInvitationId;

    if (!inviteId) {
      await page.goto("/settings");
      const inviteEmail = `switch-${run}@example.com`;
      const response = await apiCall<{ error?: string }>(page, "/api/team/invitations", {
        method: "POST",
        body: { email: inviteEmail },
      });
      expect(response.status).toBe(200);

      const [invite] = await db
        .select()
        .from(invitation)
        .where(and(eq(invitation.organizationId, TEST_ORG_ID), eq(invitation.email, inviteEmail)));
      inviteId = invite?.id ?? "";
    }

    expect(inviteId).toBeTruthy();

    await page.goto(`/accept-invitation?id=${inviteId}`);
    await expect(page.getByText("Switch accounts to continue")).toBeVisible();

    await page.getByRole("button", { name: "Log out" }).click();

    await expect(page.locator("form").getByRole("button", { name: "Create Account" })).toBeEnabled();
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page.locator("form").getByRole("button", { name: "Sign In" })).toBeEnabled();
  });

  test("member accepts invite with no module access by default", async ({ browser, db }) => {
    const accepted = await acceptInviteAsNewUser(
      browser,
      memberInvitationId,
      memberEmail,
      memberName,
      memberPassword
    );

    await expect(accepted.page).toHaveURL(/\/settings$/);
    await expect(accepted.page.locator('a[href="/sales/orders"]')).toHaveCount(0);
    await expect(accepted.page.locator('a[href="/inventory/products"]')).toHaveCount(0);

    const [memberUser] = await db.select().from(user).where(eq(user.email, memberEmail));
    expect(memberUser).toBeTruthy();
    memberUserId = memberUser.id;

    const [memberRow] = await db
      .select()
      .from(member)
      .where(and(eq(member.organizationId, TEST_ORG_ID), eq(member.userId, memberUser.id)));
    expectRoleIncludes(memberRow.role, ["access:matrix", "member"]);
    memberMemberId = memberRow.id;

    const blockedSales = await apiCall<{ error?: string }>(accepted.page, "/api/sales-orders", {
      method: "POST",
      body: {},
    });
    expect(blockedSales.status).toBe(403);

    await accepted.context.close();
  });

  test("settings admin can access team settings and grant other settings admins", async ({
    browser,
    db,
    page: ownerPage,
  }) => {
    const accepted = await acceptInviteAsNewUser(
      browser,
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
    expectRoleIncludes(adminRow.role, ["access:matrix", "member"]);
    adminMemberId = adminRow.id;

    await accepted.context.close();

    const promoteResponse = await apiCall<{ error?: string }>(
      ownerPage,
      `/api/team/members/${adminMemberId}`,
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
    expect(promoteResponse.status).toBe(200);

    const { context, page } = await signInAsExistingUser(browser, adminEmail, adminPassword);
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();

    await page.getByRole("button", { name: "Invite member" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Email")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    const allowedInvite = await apiCall<{ error?: string }>(page, "/api/team/invitations", {
      method: "POST",
      body: { email: `settings-admin-invite-${run}@example.com` },
    });
    expect(allowedInvite.status).toBe(200);

    const allowedAdminPatch = await apiCall<{ error?: string }>(
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
    expect(allowedAdminPatch.status).toBe(200);

    await context.close();
  });

  test("owner can assign module access from the team matrix", async ({ page, db }) => {
    await page.goto("/settings");
    const memberRow = memberRowByEmail(page, memberEmail);
    await expect(memberRow).toBeVisible();

    await setMatrixAccess(page, memberEmail, "sales", "operate");

    const [updatedMember] = await db
      .select()
      .from(member)
      .where(eq(member.id, memberMemberId));
    expectRoleIncludes(updatedMember.role, [
      "access:matrix",
      "member",
      "sales:operate",
    ]);
  });

  test("member with inventory operate can create materials and unlocked products", async ({
    browser,
    page,
    db,
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
      "/inventory/products"
    );

    await expect(memberPage.locator('a[href="/inventory/products"]')).toHaveCount(1);
    await expect(memberPage.locator('a[href="/sales/orders"]')).toHaveCount(0);

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

    await context.close();
  });

  test("member with manufacturing operate can create orders and view BOMs but cannot edit products", async ({
    browser,
    page,
    db,
  }) => {
    const [product] = await db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.organizationId, TEST_ORG_ID), eq(items.itemType, "product")))
      .limit(1);

    expect(product).toBeTruthy();

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
      "/inventory/products"
    );

    await memberPage.goto(`/inventory/products/${product.id}`);
    await expect(memberPage).toHaveURL(new RegExp(`/inventory/products/${product.id}$`));
    await expect(
      memberPage.getByRole("heading", { name: "Recipe / Bill of Materials" })
    ).toBeVisible();
    await expect(memberPage.getByRole("link", { name: "Edit" })).toHaveCount(0);

    await memberPage.goto(`/inventory/products/${product.id}/edit`);
    await memberPage.waitForURL("**/inventory/products");

    await context.close();
  });

  test("locked BOMs require inventory admin to view or edit recipe details", async ({
    browser,
    page: ownerPage,
    db,
  }) => {
    await ownerPage.goto("/settings");

    const [unit] = await db
      .select({ id: unitDefinitions.id })
      .from(unitDefinitions)
      .where(eq(unitDefinitions.organizationId, TEST_ORG_ID))
      .limit(1);

    expect(unit).toBeTruthy();

    const lockMaterial = await apiCall<{ id?: string }>(ownerPage, "/api/items", {
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

    const lockedProduct = await apiCall<{ id?: string }>(ownerPage, "/api/items", {
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

    const lockResponse = await apiCall<{ bomLocked?: boolean; error?: string }>(
      ownerPage,
      `/api/items/${lockedProduct.body?.id}/bom-lock`,
      {
        method: "POST",
        body: { locked: true },
      }
    );
    expect(lockResponse.status).toBe(200);
    expect(lockResponse.body?.bomLocked).toBe(true);

    await updateMemberAccess(ownerPage, {
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
      "/inventory/products"
    );

    await memberPage.goto(`/inventory/products/${lockedProduct.body?.id}`);
    await expect(memberPage.getByLabel("Locked recipe")).toBeVisible();
    await expect(
      memberPage.getByText("This recipe is locked. Inventory or manufacturing admin access is required")
    ).toBeVisible();
    await expect(memberPage.getByText(`Locked Material ${run}`)).toHaveCount(0);
    await expect(memberPage.getByRole("link", { name: "Edit" })).toHaveCount(0);

    await memberPage.goto(`/inventory/products/${lockedProduct.body?.id}/edit`);
    await memberPage.waitForURL(`**/inventory/products/${lockedProduct.body?.id}`);

    const blockedLockedProductMutation = await apiCall<{ error?: string }>(
      memberPage,
      `/api/items/${lockedProduct.body?.id}`,
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

    await updateMemberAccess(ownerPage, {
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
      "/inventory/products"
    );

    await adminPage.goto(`/inventory/products/${lockedProduct.body?.id}`);
    await expect(adminPage.getByText(`Locked Material ${run}`)).toBeVisible();
    await expect(adminPage.getByRole("link", { name: "Edit" })).toBeVisible();
    await adminPage.getByRole("link", { name: "Edit" }).click();
    await expect(adminPage).toHaveURL(
      new RegExp(`/inventory/products/${lockedProduct.body?.id}/edit$`)
    );
    await expect(adminPage.getByRole("button", { name: "Unlock recipe" })).toBeVisible();

    await adminContext.close();
  });

  test("member with sales operate can access sales but not inventory or team", async ({
    browser,
    page: ownerPage,
  }) => {
    await updateMemberAccess(ownerPage, {
      inventory: "none",
      sales: "operate",
      manufacturing: "none",
      purchasing: "none",
      settings: "none",
    });

    const { context, page } = await signInAsExistingUser(
      browser,
      memberEmail,
      memberPassword,
      "/sales/orders"
    );

    await expect(page.locator('a[href="/sales/orders"]')).toHaveCount(1);
    await expect(page.locator('a[href="/inventory/products"]')).toHaveCount(0);

    await page.goto("/sales/orders");
    await expect(page).toHaveURL(/\/sales\/orders$/);
    await expect(page.getByLabel("Search orders")).toBeVisible();

    await page.goto("/inventory/products");
    await page.waitForURL("**/sales/orders");

    await page.goto("/sales/pricing");
    await page.waitForURL("**/sales/orders");

    await page.goto("/sales/pricing/schedules/new");
    await page.waitForURL("**/sales/orders");

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
      "/api/manufacturing-orders",
      { method: "POST", body: {} }
    );
    expect(blockedManufacturingMutation.status).toBe(403);

    const blockedPurchasingMutation = await apiCall<{ error?: string }>(
      page,
      `/api/purchase-orders/${BLOCKED_ROUTE_ID}/receive`,
      { method: "POST", body: {} }
    );
    expect(blockedPurchasingMutation.status).toBe(403);

    const blockedPricingMutation = await apiCall<{ error?: string }>(page, "/api/customer-categories", {
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

    await expect(memberPage.locator('a[href="/purchasing/orders"]')).toHaveCount(1);
    await expect(memberPage.locator('a[href="/inventory/products"]')).toHaveCount(0);
    await expect(memberPage.locator('a[href="/sales/orders"]')).toHaveCount(0);

    await memberPage.goto("/purchasing/orders/new");
    await expect(memberPage).toHaveURL(/\/purchasing\/orders\/new$/);

    await memberPage.goto("/purchasing/suppliers/new");
    await expect(memberPage).toHaveURL(/\/purchasing\/suppliers\/new$/);

    await memberPage.goto("/sales/orders");
    await memberPage.waitForURL("**/purchasing/orders");

    const blockedSalesMutation = await apiCall<{ error?: string }>(memberPage, "/api/sales-orders", {
      method: "POST",
      body: {},
    });
    expect(blockedSalesMutation.status).toBe(403);

    await context.close();
  });

  test("owner can remove a member without deleting the underlying auth account", async ({ page, db }) => {
    await page.goto("/settings");
    const memberRow = memberRowByEmail(page, memberEmail);
    const removeResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/team/members/${memberMemberId}`) &&
        response.request().method() === "DELETE"
    );
    await memberRow.getByRole("button", { name: new RegExp(`Remove ${memberEmail}`) }).click();
    await removeResponse;
    await expect(memberRow).toHaveCount(0);

    const memberRows = await db
      .select()
      .from(member)
      .where(eq(member.id, memberMemberId));
    expect(memberRows).toHaveLength(0);

    const [persistedUser] = await db.select().from(user).where(eq(user.id, memberUserId));
    expect(persistedUser.email).toBe(memberEmail);
  });
});
