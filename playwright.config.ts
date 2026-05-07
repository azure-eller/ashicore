import fs from "node:fs";
import { defineConfig } from "@playwright/test";
import { loadWorktreeEnv } from "./scripts/load-worktree-env";
import {
  TEST_STORAGE_STATE_PATH,
} from "./test/helpers/test-env";

loadWorktreeEnv();

let baseURL = "http://localhost:3000";
const includeParkedPlanningTests = process.env.INCLUDE_PARKED_PLANNING === "1";
try {
  const env = JSON.parse(fs.readFileSync("test/.test-env.json", "utf-8"));
  baseURL = env.TEST_BASE_URL;
} catch {
  // .test-env.json may not exist yet — fall back to default
}

export default defineConfig({
  testDir: "./test/e2e",
  testIgnore: includeParkedPlanningTests ? [] : ["**/fast/planning.spec.ts"],
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  globalSetup: "./test/global-setup.ts",
  use: {
    baseURL,
    storageState: TEST_STORAGE_STATE_PATH,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    launchOptions: {
      slowMo: Number(process.env.SLOW_MO) || 0,
    },
    viewport: process.env.VIEWPORT
      ? {
          width: Number(process.env.VIEWPORT.split(",")[0]),
          height: Number(process.env.VIEWPORT.split(",")[1]),
        }
      : { width: 1280, height: 720 },
  },
});
