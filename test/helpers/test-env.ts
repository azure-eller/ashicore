import fs from "node:fs";
import path from "node:path";

export interface TestEnv {
  TEST_SESSION_COOKIE: string;
  TEST_ORG_ID: string;
  TEST_UNIT_ID: string;
  TEST_BASE_URL: string;
  TEST_TIMESTAMP?: number;
  TEST_STORAGE_STATE?: string;
}

export const TEST_ENV_PATH = path.resolve(__dirname, "../.test-env.json");
export const TEST_STORAGE_STATE_PATH = path.resolve(
  __dirname,
  "../.auth/storage-state.json"
);
export const REVIEW_ENV_PATH = path.resolve(__dirname, "../.review-env.json");
export const REVIEW_STORAGE_STATE_PATH = path.resolve(
  __dirname,
  "../.auth/review-storage-state.json"
);

const AGENT_SESSION_PATH = path.resolve(
  __dirname,
  "../../.tmp/agent-session.json"
);

/**
 * Resolve the dev-server base URL for the Playwright lanes.
 *
 * `pnpm boot` starts the dev server on a free (non-3000) port and records it in
 * `.tmp/agent-session.json` (and, after global-setup, `test/.test-env.json`).
 * The lanes must target that running server, so prefer those over the legacy
 * `localhost:3000` default. An explicit `TEST_BASE_URL` still wins.
 */
export function resolveBaseUrl(): string {
  if (process.env.TEST_BASE_URL) return process.env.TEST_BASE_URL;

  try {
    const session = JSON.parse(fs.readFileSync(AGENT_SESSION_PATH, "utf-8"));
    if (typeof session.baseUrl === "string" && session.baseUrl) {
      return session.baseUrl;
    }
  } catch {
    // no agent-session yet — fall through
  }

  try {
    const env = JSON.parse(fs.readFileSync(TEST_ENV_PATH, "utf-8"));
    if (typeof env.TEST_BASE_URL === "string" && env.TEST_BASE_URL) {
      return env.TEST_BASE_URL;
    }
  } catch {
    // no test-env yet — fall through
  }

  return "http://localhost:3000";
}

export function parseCookie(raw: string): { name: string; value: string } {
  const [name, ...rest] = raw.split("=");
  return { name, value: rest.join("=") };
}

export function readTestEnv(): TestEnv {
  if (!fs.existsSync(TEST_ENV_PATH)) {
    throw new Error(
      "test/.test-env.json not found. Did global-setup run? Is the dev server running?"
    );
  }

  return JSON.parse(fs.readFileSync(TEST_ENV_PATH, "utf-8")) as TestEnv;
}

export function writeTestEnv(env: TestEnv, envPath: string = TEST_ENV_PATH) {
  fs.writeFileSync(envPath, JSON.stringify(env, null, 2));
}

export function setTestTimestamp(ts: number): number {
  const env = readTestEnv();
  env.TEST_TIMESTAMP = ts;
  writeTestEnv(env);
  return ts;
}

export function buildStorageState(
  rawCookie: string,
  baseUrl: string
): {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Lax";
  }>;
  origins: [];
} {
  const url = new URL(baseUrl);
  const isSecure = url.protocol === "https:";

  const cookies = rawCookie
    .split("; ")
    .filter(Boolean)
    .map((pair) => {
      const { name, value } = parseCookie(pair);
      return {
        name,
        value,
        domain: url.hostname,
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: isSecure,
        sameSite: "Lax" as const,
      };
    });

  return { cookies, origins: [] };
}

export function ensureAuthDir() {
  fs.mkdirSync(path.dirname(TEST_STORAGE_STATE_PATH), { recursive: true });
}
