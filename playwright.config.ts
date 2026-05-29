import { defineConfig } from "@playwright/test";
import { loadWorktreeEnv } from "./scripts/load-worktree-env";
import {
  TEST_STORAGE_STATE_PATH,
  resolveBaseUrl,
} from "./test/helpers/test-env";

loadWorktreeEnv();

// Prefer the live `pnpm boot` dev server (free port) over the legacy :3000.
const baseURL = resolveBaseUrl();

export default defineConfig({
  testDir: "./test/e2e",
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
