import fs from "node:fs";
import { defineConfig } from "@playwright/test";

let baseURL = "http://localhost:3000";
try {
  const env = JSON.parse(fs.readFileSync("test/.test-env.json", "utf-8"));
  baseURL = env.TEST_BASE_URL;
} catch {
  // .test-env.json may not exist yet — fall back to default
}

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 90_000,
  retries: 0,
  workers: 1,
  globalSetup: "./test/global-setup.ts",
  use: {
    baseURL,
    trace: "on-first-retry",
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
