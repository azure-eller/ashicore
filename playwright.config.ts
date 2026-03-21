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
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
});
