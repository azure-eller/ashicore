import type { Locator, Page } from "@playwright/test";
import dotenv from "dotenv";
import { isNull, sql } from "drizzle-orm";
import { test as base, expect } from "@playwright/test";
import { db as appDb } from "../../lib/db";
import { items } from "../../lib/db/schema";
import { parseCookie, readTestEnv } from "../helpers/test-env";

dotenv.config({ path: ".env.local" });

// Read the test env from the global-setup output.
const env = readTestEnv();
const testOrgId: string = env.TEST_ORG_ID;
const sessionCookie: string = env.TEST_SESSION_COOKIE;

export type TestDb = typeof appDb;

type QueryOperation = {
  property: PropertyKey;
  args: unknown[];
};

function isRetryableConnectionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const cause =
    error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  const detail = `${message} ${cause}`;

  return (
    detail.includes("connection error") ||
    detail.includes("not queryable") ||
    detail.includes("WebSocket")
  );
}

async function runWithOrgContext<T>(callback: (db: TestDb) => Promise<T>) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await appDb.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.current_org_id', ${testOrgId}, true)`);
        return callback(tx as unknown as TestDb);
      });
    } catch (error) {
      if (attempt === 0 && isRetryableConnectionError(error)) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("Failed to run test DB query");
}

function applyQueryOperations(query: unknown, operations: QueryOperation[]) {
  return operations.reduce((current, operation) => {
    const method = (current as Record<PropertyKey, unknown>)[operation.property];

    if (typeof method !== "function") {
      throw new Error(
        `Unsupported query builder property in test DB fixture: ${String(operation.property)}`
      );
    }

    return method.apply(current, operation.args);
  }, query);
}

function createAwaitableQuery(
  start: (db: TestDb) => unknown,
  operations: QueryOperation[] = []
): unknown {
  return new Proxy(() => undefined, {
    get(_target, property) {
      if (property === Symbol.toStringTag) {
        return "Promise";
      }

      if (property === "then" || property === "catch" || property === "finally") {
        const promise = runWithOrgContext(async (db) => {
          const query = applyQueryOperations(start(db), operations);
          return await query;
        });

        return promise[property].bind(promise);
      }

      return (...args: unknown[]) =>
        createAwaitableQuery(start, [...operations, { property, args }]);
    },
  });
}

function createTestDb() {
  return new Proxy({} as TestDb, {
    get(_target, property) {
      return (...args: unknown[]) =>
        createAwaitableQuery((db) => {
          const method = (db as unknown as Record<PropertyKey, unknown>)[property];

          if (typeof method !== "function") {
            throw new Error(
              `Unsupported db fixture method in Playwright tests: ${String(property)}`
            );
          }

          return method.apply(db, args);
        });
    },
  });
}

// ---------------------------------------------------------------------------
// Custom test fixture
// ---------------------------------------------------------------------------

export const test = base.extend<{ db: TestDb }>({
  // Auto-inject the session cookie into every browser context.
  // Specs no longer need their own beforeEach for cookie injection.
  context: async ({ context }, runFixture) => {
    const { name, value } = parseCookie(sessionCookie);
    await context.addCookies([
      { name, value, domain: "localhost", path: "/" },
    ]);
    await runFixture(context);
  },

  db: async ({}, runFixture) => {
    await runFixture(createTestDb());
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
  await input.click();
  await input.press(`${process.platform === "darwin" ? "Meta" : "Control"}+A`);
  await input.press("Backspace");
  await input.pressSequentially(value, { delay: 20 });
  await expect(input).toHaveValue(value);
}

export async function getInventoryTabCount(
  page: Page,
  label: "Products" | "Materials" | "Sub-assemblies"
): Promise<number> {
  const navText = await page.locator("header nav").innerText();
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = navText.match(new RegExp(`${escapedLabel}\\s*(\\d+)`));

  if (!match) {
    throw new Error(`Could not find inventory tab count for ${label}. Nav text: ${navText}`);
  }

  return Number.parseInt(match[1], 10);
}

export async function getExpectedInventoryTabCounts(db: TestDb): Promise<{
  products: number;
  materials: number;
  subAssemblies: number;
}> {
  const currentBomUsageExists = sql`
    EXISTS (
      SELECT 1
      FROM inventory.bom_revision_components brc
      INNER JOIN inventory.bom_revisions br ON br.id = brc.bom_revision_id
      INNER JOIN inventory.items parent_item ON parent_item.id = br.product_id
      WHERE brc.component_id = ${items.id}
        AND br.is_current = true
        AND parent_item.deleted_at IS NULL
    )
  `;
  const masterHasSellableVariant = sql`
    EXISTS (
      SELECT 1
      FROM inventory.items v
      WHERE v.parent_id = ${items.id}
        AND v.deleted_at IS NULL
        AND v.sellable = true
    )
  `;

  const [counts] = await db
    .select({
      products: sql<number>`COUNT(*) FILTER (
        WHERE ${items.itemType} = 'product'
          AND ${items.parentId} IS NULL
          AND (
            (${items.isMaster} = false AND ${items.sellable} = true)
            OR (${items.isMaster} = true AND ${masterHasSellableVariant})
          )
      )::int`,
      materials: sql<number>`COUNT(*) FILTER (
        WHERE ${items.itemType} = 'material'
      )::int`,
      subAssemblies: sql<number>`COUNT(*) FILTER (
        WHERE ${items.itemType} = 'product'
          AND ${items.isMaster} = false
          AND (${items.sellable} = false OR ${currentBomUsageExists})
      )::int`,
    })
    .from(items)
    .where(isNull(items.deletedAt));

  return {
    products: Number(counts?.products ?? 0),
    materials: Number(counts?.materials ?? 0),
    subAssemblies: Number(counts?.subAssemblies ?? 0),
  };
}

export async function selectDate(
  page: Page,
  trigger: Locator,
  value: string
): Promise<void> {
  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    throw new Error(`Invalid ISO date for Playwright date picker helper: ${value}`);
  }

  const targetLabel = await page.evaluate(
    ({ year, month, day }) =>
      new Date(year, month - 1, day).toLocaleDateString(),
    { year, month, day }
  );

  await trigger.click();

  const today = await page.evaluate(() => {
    const now = new Date();
    return {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
    };
  });
  const direction =
    year < today.year || (year === today.year && month < today.month)
      ? "previous"
      : "next";
  const monthButtonClass =
    direction === "previous" ? ".rdp-button_previous" : ".rdp-button_next";

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const target = page.locator(`[data-day="${targetLabel}"]`).first();

    if (await target.isVisible().catch(() => false)) {
      await target.click();
      return;
    }

    const monthButton = page.locator(monthButtonClass).last();
    if (!(await monthButton.isVisible().catch(() => false))) {
      break;
    }

    await monthButton.click();
  }

  throw new Error(`Could not find calendar day ${value} in the date picker.`);
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
