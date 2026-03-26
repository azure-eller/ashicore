/**
 * Playwright global setup — runs once before ALL test files.
 *
 * 1. Signs up a test user (or signs in if already exists)
 * 2. Creates a test org (or reuses if already exists)
 * 3. Creates a default test unit (for item creation tests)
 * 4. Stores session cookie + IDs in test/.test-env.json
 */

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const TEST_EMAIL = "test-agent@erp-test.local";
const TEST_PASSWORD = "TestPassword123!";
const TEST_NAME = "Test Agent";
const TEST_ORG = "Test Org";
const TEST_ORG_SLUG = "test-org";

async function authFetch(path: string, body: Record<string, unknown>) {
  return fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: BASE_URL,
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
  path: string,
  cookies: string,
  options: RequestInit = {}
) {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Origin: BASE_URL,
      Cookie: cookies,
      ...options.headers,
    },
    redirect: "manual",
  });
}

export default async function setup() {
  // Verify dev server is running
  try {
    await fetch(`${BASE_URL}/api/auth/ok`);
  } catch {
    throw new Error(
      `Dev server not running at ${BASE_URL}. Start it with 'pnpm dev' before running tests.`
    );
  }

  const signupRes = await authFetch("/api/auth/sign-up/email", {
    name: TEST_NAME,
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });

  let cookies = extractCookies(signupRes);

  if (!cookies) {
    const signinRes = await authFetch("/api/auth/sign-in/email", {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    cookies = extractCookies(signinRes);

    if (!cookies) {
      const body = await signinRes.text();
      throw new Error(
        `Failed to authenticate test user. Status: ${signinRes.status}, Body: ${body}`
      );
    }
  }

  const orgsRes = await fetchWithCookies(
    "/api/auth/organization/list",
    cookies
  );
  const orgsData = await orgsRes.json().catch(() => []);
  const orgs = Array.isArray(orgsData) ? orgsData : [];
  let testOrg = orgs.find(
    (o: { slug?: string }) => o.slug === TEST_ORG_SLUG
  );

  if (!testOrg) {
    const createOrgRes = await fetchWithCookies(
      "/api/auth/organization/create",
      cookies,
      {
        method: "POST",
        body: JSON.stringify({ name: TEST_ORG, slug: TEST_ORG_SLUG }),
      }
    );
    const createOrgData = await createOrgRes.json().catch(() => null);
    testOrg = createOrgData;
    const newCookies = extractCookies(createOrgRes);
    if (newCookies) cookies = newCookies;
  }

  const setOrgRes = await fetchWithCookies(
    "/api/auth/organization/set-active",
    cookies,
    {
      method: "POST",
      body: JSON.stringify({ organizationId: testOrg.id }),
    }
  );
  const setOrgCookies = extractCookies(setOrgRes);
  if (setOrgCookies) cookies = setOrgCookies;

  const unitName = `test-unit-${Date.now()}`;
  const unitRes = await fetchWithCookies("/api/units", cookies, {
    method: "POST",
    body: JSON.stringify({ name: unitName, size: "1", uom: "kg" }),
  });
  const unitData = await unitRes.json().catch(() => null);
  const testUnitId = unitData?.id || "";

  const fs = await import("node:fs");

  // Preserve TEST_TIMESTAMP if it exists — inventory owns it and overwrites on each run.
  let existingTimestamp: number | undefined;
  try {
    const prev = JSON.parse(fs.readFileSync("test/.test-env.json", "utf-8"));
    existingTimestamp = prev.TEST_TIMESTAMP;
  } catch {
    // First run — no file yet
  }

  const testEnv: Record<string, unknown> = {
    TEST_SESSION_COOKIE: cookies,
    TEST_ORG_ID: testOrg.id,
    TEST_UNIT_ID: testUnitId || "",
    TEST_BASE_URL: BASE_URL,
  };
  if (existingTimestamp != null) {
    testEnv.TEST_TIMESTAMP = existingTimestamp;
  }
  fs.writeFileSync(
    "test/.test-env.json",
    JSON.stringify(testEnv, null, 2)
  );

  console.log(
    `\n  Test setup complete: user=${TEST_EMAIL}, org=${TEST_ORG_SLUG}, unit=${testUnitId || "reused"}\n`
  );
}

// Test data is isolated by RLS — no cleanup needed.
// The test org's data is invisible to real users.
