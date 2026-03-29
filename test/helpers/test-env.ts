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

export function writeTestEnv(env: TestEnv) {
  fs.writeFileSync(TEST_ENV_PATH, JSON.stringify(env, null, 2));
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
  const { name, value } = parseCookie(rawCookie);
  const url = new URL(baseUrl);

  return {
    cookies: [
      {
        name,
        value,
        domain: url.hostname,
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: url.protocol === "https:",
        sameSite: "Lax",
      },
    ],
    origins: [],
  };
}

export function ensureAuthDir() {
  fs.mkdirSync(path.dirname(TEST_STORAGE_STATE_PATH), { recursive: true });
}
