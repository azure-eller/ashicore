import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
  TEST_ACCOUNT_EMAIL,
  TEST_ACCOUNT_NAME,
  TEST_ACCOUNT_ORG_NAME,
  TEST_ACCOUNT_ORG_SLUG,
  TEST_ACCOUNT_PASSWORD,
} from "./test-account";
import {
  TEST_STORAGE_STATE_PATH,
  type TestEnv,
  buildStorageState,
  ensureAuthDir,
  writeTestEnv,
} from "./test-env";

type TestOrganization = {
  id: string;
  name?: string | null;
  slug?: string | null;
};

type TestAccountSetupOptions = {
  baseUrl?: string;
  log?: (message: string) => void;
};

type TestAccountSetupResult = {
  email: string;
  organizationId: string;
  organizationSlug: string;
  unitId: string;
  baseUrl: string;
};

function getBaseUrl(baseUrl?: string) {
  return baseUrl ?? process.env.TEST_BASE_URL ?? "http://localhost:3000";
}

function getOwnerConnectionString() {
  return process.env.DATABASE_URL ?? process.env.DATABASE_URL_APP;
}

async function authFetch(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>
) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
    },
    body: JSON.stringify(body),
    redirect: "manual",
  });
}

function extractCookies(res: Response): string {
  const cookies: string[] = [];
  res.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      cookies.push(value.split(";")[0]);
    }
  });
  return cookies.join("; ");
}

async function fetchWithCookies(
  baseUrl: string,
  path: string,
  cookies: string,
  options: RequestInit = {}
) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      Cookie: cookies,
      ...options.headers,
    },
    redirect: "manual",
  });
}

async function listOrganizations(baseUrl: string, cookies: string) {
  const orgsRes = await fetchWithCookies(
    baseUrl,
    "/api/auth/organization/list",
    cookies
  );
  const orgsData = await orgsRes.json().catch(() => []);
  return Array.isArray(orgsData) ? (orgsData as TestOrganization[]) : [];
}

async function createSession(baseUrl: string) {
  const signupRes = await authFetch(baseUrl, "/api/auth/sign-up/email", {
    name: TEST_ACCOUNT_NAME,
    email: TEST_ACCOUNT_EMAIL,
    password: TEST_ACCOUNT_PASSWORD,
  });

  let cookies = extractCookies(signupRes);

  if (!cookies) {
    const signinRes = await authFetch(baseUrl, "/api/auth/sign-in/email", {
      email: TEST_ACCOUNT_EMAIL,
      password: TEST_ACCOUNT_PASSWORD,
    });
    cookies = extractCookies(signinRes);

    if (!cookies) {
      const body = await signinRes.text();
      throw new Error(
        `Failed to authenticate ${TEST_ACCOUNT_EMAIL}. Status: ${signinRes.status}, Body: ${body}`
      );
    }
  }

  return cookies;
}

async function ensureExistingOrgMembership() {
  const connectionString = getOwnerConnectionString();

  if (!connectionString) {
    return null;
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const userResult = await client.query<{ id: string }>(
      'SELECT id FROM system."user" WHERE email = $1 LIMIT 1',
      [TEST_ACCOUNT_EMAIL]
    );
    const orgResult = await client.query<{
      id: string;
      name: string | null;
      slug: string | null;
    }>(
      "SELECT id, name, slug FROM system.organization WHERE slug = $1 LIMIT 1",
      [TEST_ACCOUNT_ORG_SLUG]
    );

    const testUser = userResult.rows[0];
    const testOrg = orgResult.rows[0];

    if (!testUser || !testOrg) {
      return null;
    }

    const membershipResult = await client.query<{ id: string; role: string }>(
      "SELECT id, role FROM system.member WHERE user_id = $1 AND organization_id = $2 LIMIT 1",
      [testUser.id, testOrg.id]
    );
    const membership = membershipResult.rows[0];

    if (membership) {
      if (membership.role !== "owner") {
        await client.query("UPDATE system.member SET role = $1 WHERE id = $2", [
          "owner",
          membership.id,
        ]);
      }
    } else {
      await client.query(
        "INSERT INTO system.member (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, NOW())",
        [randomUUID(), testOrg.id, testUser.id, "owner"]
      );
    }

    return testOrg;
  } finally {
    await client.end();
  }
}

async function ensureOrganization(baseUrl: string, cookies: string) {
  let orgs = await listOrganizations(baseUrl, cookies);
  let testOrg = orgs.find((org) => org.slug === TEST_ACCOUNT_ORG_SLUG);

  if (testOrg) {
    return testOrg;
  }

  const createOrgRes = await fetchWithCookies(
    baseUrl,
    "/api/auth/organization/create",
    cookies,
    {
      method: "POST",
      body: JSON.stringify({
        name: TEST_ACCOUNT_ORG_NAME,
        slug: TEST_ACCOUNT_ORG_SLUG,
      }),
    }
  );
  const createOrgData = await createOrgRes.json().catch(() => null);
  testOrg = createOrgData?.id ? createOrgData : null;

  if (testOrg) {
    return testOrg;
  }

  orgs = await listOrganizations(baseUrl, cookies);
  testOrg = orgs.find((org) => org.slug === TEST_ACCOUNT_ORG_SLUG);

  if (testOrg) {
    return testOrg;
  }

  return ensureExistingOrgMembership();
}

async function setActiveOrganization(
  baseUrl: string,
  cookies: string,
  organizationId: string
) {
  const setOrgRes = await fetchWithCookies(
    baseUrl,
    "/api/auth/organization/set-active",
    cookies,
    {
      method: "POST",
      body: JSON.stringify({ organizationId }),
    }
  );
  return extractCookies(setOrgRes) || cookies;
}

async function createDefaultUnit(baseUrl: string, cookies: string) {
  const unitName = `test-unit-${Date.now()}`;
  const unitRes = await fetchWithCookies(baseUrl, "/api/units", cookies, {
    method: "POST",
    body: JSON.stringify({ name: unitName, size: "1", uom: "kg" }),
  });
  const unitBody = await unitRes.text();
  let unitData: { id?: unknown } | null = null;
  try {
    unitData = JSON.parse(unitBody || "null") as { id?: unknown } | null;
  } catch {
    // The error below includes the raw response body for debugging.
  }

  if (!unitData?.id) {
    throw new Error(
      `Failed to create default test unit. Status: ${unitRes.status}, Body: ${unitBody}`
    );
  }

  return unitData.id as string;
}

function readExistingTimestamp() {
  try {
    const prev = JSON.parse(fs.readFileSync("test/.test-env.json", "utf-8"));
    return prev.TEST_TIMESTAMP as number | undefined;
  } catch {
    return undefined;
  }
}

export async function ensureTestAccount(
  options: TestAccountSetupOptions = {}
): Promise<TestAccountSetupResult> {
  const baseUrl = getBaseUrl(options.baseUrl);

  try {
    await fetch(`${baseUrl}/api/auth/ok`);
  } catch {
    throw new Error(
      `Dev server not running at ${baseUrl}. Start it with 'pnpm dev' before seeding the test user.`
    );
  }

  let cookies = await createSession(baseUrl);
  const testOrg = await ensureOrganization(baseUrl, cookies);

  if (!testOrg?.id) {
    throw new Error(
      `Failed to resolve test organization '${TEST_ACCOUNT_ORG_SLUG}'.`
    );
  }

  cookies = await setActiveOrganization(baseUrl, cookies, testOrg.id);
  const testUnitId = await createDefaultUnit(baseUrl, cookies);
  const existingTimestamp = readExistingTimestamp();
  const testEnv: TestEnv = {
    TEST_SESSION_COOKIE: cookies,
    TEST_ORG_ID: testOrg.id,
    TEST_UNIT_ID: testUnitId,
    TEST_BASE_URL: baseUrl,
    TEST_STORAGE_STATE: TEST_STORAGE_STATE_PATH,
  };

  if (existingTimestamp != null) {
    testEnv.TEST_TIMESTAMP = existingTimestamp;
  }

  writeTestEnv(testEnv);
  ensureAuthDir();
  fs.writeFileSync(
    TEST_STORAGE_STATE_PATH,
    JSON.stringify(buildStorageState(cookies, baseUrl), null, 2)
  );

  options.log?.(
    `Test account ready: user=${TEST_ACCOUNT_EMAIL}, org=${TEST_ACCOUNT_ORG_SLUG}, unit=${testUnitId}`
  );

  return {
    email: TEST_ACCOUNT_EMAIL,
    organizationId: testOrg.id,
    organizationSlug: TEST_ACCOUNT_ORG_SLUG,
    unitId: testUnitId,
    baseUrl,
  };
}
