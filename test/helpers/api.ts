import fs from "node:fs";
import path from "node:path";

interface TestEnv {
  TEST_SESSION_COOKIE: string;
  TEST_ORG_ID: string;
  TEST_UNIT_ID: string;
  TEST_BASE_URL: string;
}

let _env: TestEnv | null = null;

function getTestEnv(): TestEnv {
  if (_env) return _env;
  const envPath = path.resolve(__dirname, "../.test-env.json");
  if (!fs.existsSync(envPath)) {
    throw new Error(
      "test/.test-env.json not found. Did global-setup run? Is the dev server running?"
    );
  }
  _env = JSON.parse(fs.readFileSync(envPath, "utf-8"));
  return _env!;
}

export function getBaseUrl() {
  return getTestEnv().TEST_BASE_URL;
}

export function getSessionCookie() {
  return getTestEnv().TEST_SESSION_COOKIE;
}

export function getOrgId() {
  return getTestEnv().TEST_ORG_ID;
}

export function getUnitId() {
  return getTestEnv().TEST_UNIT_ID;
}

/**
 * Make an authenticated fetch to the API.
 */
export async function testFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const base = getBaseUrl();
  return fetch(`${base}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Origin: base,
      Cookie: getSessionCookie(),
      ...options.headers,
    },
  });
}

/**
 * POST /api/items
 */
export async function createItem(data: Record<string, unknown>) {
  const res = await testFetch("/api/items", {
    method: "POST",
    body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

/**
 * PUT /api/items/:id
 */
export async function updateItem(id: string, data: Record<string, unknown>) {
  const res = await testFetch(`/api/items/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

/**
 * DELETE /api/items/:id
 */
export async function deleteItem(id: string) {
  const res = await testFetch(`/api/items/${id}`, { method: "DELETE" });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

/**
 * POST /api/units
 */
export async function createUnit(data: {
  name: string;
  size: string;
  uom: string;
}) {
  const res = await testFetch("/api/units", {
    method: "POST",
    body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}
