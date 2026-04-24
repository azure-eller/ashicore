/**
 * Playwright global setup — runs once before ALL test files.
 *
 * 1. Signs up a test user (or signs in if already exists)
 * 2. Creates a test org (or reuses if already exists)
 * 3. Creates a default test unit (for item creation tests)
 * 4. Stores session cookie + IDs in test/.test-env.json
 * 5. Writes authenticated Playwright storage state for browser tests
 */

import fs from "node:fs";
import path from "node:path";
import { EMAIL_OUTBOX_DIR, EMAIL_OUTBOX_MODE_FLAG } from "../lib/email/outbox";
import { ensureTestAccount } from "./helpers/test-account-setup";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

export default async function setup() {
  fs.rmSync(EMAIL_OUTBOX_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(EMAIL_OUTBOX_MODE_FLAG), { recursive: true });
  fs.writeFileSync(EMAIL_OUTBOX_MODE_FLAG, "1");

  await ensureTestAccount({
    baseUrl: BASE_URL,
    log: (message) => console.log(`\n  ${message}\n`),
  });
}

// Test data is isolated by RLS — no cleanup needed.
// The test org's data is invisible to real users.
