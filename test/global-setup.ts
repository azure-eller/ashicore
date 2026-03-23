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

  // 1. Try to sign up (will fail with 400/409 if user exists, that's fine)
  const signupRes = await authFetch("/api/auth/sign-up/email", {
    name: TEST_NAME,
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });

  let cookies = extractCookies(signupRes);

  // 2. If signup didn't return cookies (user already exists), sign in
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

  // 3. Check if test org exists by listing orgs
  const orgsRes = await fetchWithCookies(
    "/api/auth/organization/list",
    cookies
  );
  const orgsData = await orgsRes.json().catch(() => []);
  const orgs = Array.isArray(orgsData) ? orgsData : [];
  let testOrg = orgs.find(
    (o: { slug?: string }) => o.slug === TEST_ORG_SLUG
  );

  // 4. Create org if it doesn't exist
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
    // Creating an org may update the session cookie
    const newCookies = extractCookies(createOrgRes);
    if (newCookies) cookies = newCookies;
  }

  // 5. Set active org
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

  // 6. Create a default test unit
  // Try creating — if it already exists, the API returns an error but we
  // can just create one with a unique name per run
  const unitName = `test-unit-${Date.now()}`;
  const unitRes = await fetchWithCookies("/api/units", cookies, {
    method: "POST",
    body: JSON.stringify({ name: unitName, size: "1", uom: "kg" }),
  });
  const unitData = await unitRes.json().catch(() => null);
  const testUnitId = unitData?.id || "";

  // Write to a file so test processes can read it
  // (globalSetup runs in a separate process from tests)
  const fs = await import("node:fs");
  const testEnv = {
    TEST_SESSION_COOKIE: cookies,
    TEST_ORG_ID: testOrg.id,
    TEST_UNIT_ID: testUnitId || "",
    TEST_BASE_URL: BASE_URL,
  };
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
