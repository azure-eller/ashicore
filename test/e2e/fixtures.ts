import fs from "node:fs";
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

// Read the test org ID from the global-setup output.
const env = JSON.parse(fs.readFileSync("test/.test-env.json", "utf-8"));
const testOrgId: string = env.TEST_ORG_ID;

export type TestDb = typeof testDb;

export const test = base.extend<{ db: TestDb }>({
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
