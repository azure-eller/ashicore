import fs from "node:fs";
import type { Page } from "@playwright/test";
import dotenv from "dotenv";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";
import { test as base, expect } from "@playwright/test";
import * as schema from "../../lib/db/schema";

dotenv.config({ path: ".env.local" });

// App role — same connection the app uses, RLS enforced.
const connectionString =
  process.env.DATABASE_URL_APP || process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const testDb = drizzle({ client: pool, schema });

// Read the test env from the global-setup output.
const env = JSON.parse(fs.readFileSync("test/.test-env.json", "utf-8"));
const testOrgId: string = env.TEST_ORG_ID;
const sessionCookie: string = env.TEST_SESSION_COOKIE;

export type TestDb = typeof testDb;

// ---------------------------------------------------------------------------
// Cookie helper
// ---------------------------------------------------------------------------

function parseCookie(raw: string): { name: string; value: string } {
  const [name, ...rest] = raw.split("=");
  return { name, value: rest.join("=") };
}

// ---------------------------------------------------------------------------
// Custom test fixture
// ---------------------------------------------------------------------------

export const test = base.extend<{ db: TestDb }>({
  // Auto-inject the session cookie into every browser context.
  // Specs no longer need their own beforeEach for cookie injection.
  context: async ({ context }, use) => {
    const { name, value } = parseCookie(sessionCookie);
    await context.addCookies([
      { name, value, domain: "localhost", path: "/" },
    ]);
    await use(context);
  },

  db: async ({}, use) => {
    // Wrap in a transaction that sets the RLS org context,
    // then hands the transaction to the test.
    await testDb.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.current_org_id', ${testOrgId}, true)`
      );
      await use(tx as unknown as TestDb);
    });
  },
});

export { expect };

// ---------------------------------------------------------------------------
// Shared UI helpers
// ---------------------------------------------------------------------------

/**
 * Type a value into a list-page search/filter input and wait for the value
 * to be committed. Works for any data-table search field identified by label.
 */
export async function filterList(
  page: Page,
  label: string,
  value: string
): Promise<void> {
  const input = page.getByLabel(label);
  await input.fill(value);
  await expect(input).toHaveValue(value);
}

/**
 * Extract the trailing UUID segment from a page URL.
 * Throws if the URL does not end with a parseable id.
 */
export function getIdFromUrl(url: string): string {
  const id = url.split("/").at(-1);
  if (!id) {
    throw new Error(`Could not parse id from URL: ${url}`);
  }
  return id;
}
