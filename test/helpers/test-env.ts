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
