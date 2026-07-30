import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { loadWorktreeEnv } from "./load-worktree-env";
import { getCommonRepoRoot } from "./local-db";
import { REVIEW_ORG_SLUG } from "./agent-session";

loadWorktreeEnv();

const REVIEW_ORG_NAME = "Test Paonia Soil Co.";
const REAL_PAONIA_ORG_SLUG = "paonia-soil-company";
const DEFAULT_SOURCE_ENV_FILE = ".vercel/.env.production.local";
const CACHED_SNAPSHOT_FILE = resolve(".tmp", "paonia-current.json");
const CACHED_SNAPSHOT_META = resolve(".tmp", "paonia-current.meta.json");

// Prod creds live at the repo root; a worktree may not have its own copy.
function resolveSourceEnvFile(): string | null {
  const explicit = process.env.PAONIA_SOURCE_ENV_FILE;
  const candidates = explicit
    ? [resolve(explicit)]
    : [
        resolve(DEFAULT_SOURCE_ENV_FILE),
        resolve(getCommonRepoRoot(), DEFAULT_SOURCE_ENV_FILE),
      ];
  return candidates.find((path) => existsSync(path)) ?? null;
}

// Ensure the review user/org/session exists, writing the REVIEW env files only
// (the test-org session used by automated tests is left untouched). Returns the
// review organization id. Does NOT touch the snapshot data.
export async function ensureReviewSession(options: {
  baseUrl: string;
  log?: (message: string) => void;
}): Promise<string> {
  const log = options.log ?? console.log;
  const previousTestEnv = {
    TEST_ORG: process.env.TEST_ORG,
    TEST_ORG_SLUG: process.env.TEST_ORG_SLUG,
    TEST_BASE_URL: process.env.TEST_BASE_URL,
  };

  // Force the review org — must NOT be `??=`. If TEST_ORG_SLUG were already set
  // (e.g. by a prior boot in the same process), `??=` would silently target the
  // wrong org. ensureTestAccount is dynamically imported so these take effect.
  process.env.TEST_ORG = REVIEW_ORG_NAME;
  process.env.TEST_ORG_SLUG = REVIEW_ORG_SLUG;
  process.env.TEST_BASE_URL = options.baseUrl;

  try {
    const { ensureTestAccount, REVIEW_ENV_PATH, REVIEW_STORAGE_STATE_PATH } =
      await import("../test/helpers/test-account-setup");

    const result = await ensureTestAccount({
      baseUrl: options.baseUrl,
      log,
      envPath: REVIEW_ENV_PATH,
      storageStatePath: REVIEW_STORAGE_STATE_PATH,
    });

    return result.organizationId;
  } finally {
    for (const [key, value] of Object.entries(previousTestEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

// True when the review org already holds snapshot data (mirrors the
// hasSeededSalesOrders signal in seed-dev-user.ts). Used by `pnpm sandbox` to
// preserve a triage session instead of re-importing.
export async function isReviewOrgSeeded(): Promise<boolean> {
  const connectionString =
    process.env.DATABASE_URL ?? process.env.DATABASE_URL_APP;
  if (!connectionString) {
    return false;
  }

  let orgId: string | undefined;
  try {
    // Import from test-env (a pure paths module), NOT test-account-setup: the
    // latter transitively loads test-account.ts, whose org-slug constant freezes
    // to process.env.TEST_ORG_SLUG at first import. Loading it here — before
    // ensureReviewSession sets the slug — would poison the review session.
    const { REVIEW_ENV_PATH } = await import("../test/helpers/test-env");
    orgId = JSON.parse(readFileSync(REVIEW_ENV_PATH, "utf8")).TEST_ORG_ID;
  } catch {
    return false;
  }
  if (!orgId) {
    return false;
  }

  const { Client } = await import("pg");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    // Seeded if the org holds any core Paonia data. Check several tables so the
    // signal doesn't depend on the snapshot populating one specific table.
    const result = await client.query<{ seeded: boolean }>(
      `SELECT (
         EXISTS (SELECT 1 FROM inventory.items WHERE organization_id = $1)
         OR EXISTS (SELECT 1 FROM sales.customers WHERE organization_id = $1)
         OR EXISTS (SELECT 1 FROM sales.sales_orders WHERE organization_id = $1)
       ) AS seeded`,
      [orgId]
    );
    return result.rows[0]?.seeded === true;
  } finally {
    await client.end();
  }
}

export async function seedReviewOrg(options: {
  baseUrl: string;
  cached: boolean;
  log?: (message: string) => void;
}) {
  const log = options.log ?? console.log;
  const sourceOrgSlug =
    process.env.PAONIA_SOURCE_ORG_SLUG ?? REAL_PAONIA_ORG_SLUG;
  const snapshotFile = CACHED_SNAPSHOT_FILE;

  const { exportPaoniaSnapshot, importPaoniaSnapshot } = await import(
    "./paonia-snapshot"
  );

  if (options.cached) {
    if (!existsSync(CACHED_SNAPSHOT_FILE)) {
      throw new Error(
        `--cached requested but no snapshot at ${CACHED_SNAPSHOT_FILE}. Run 'pnpm review' once without --cached to create it.`
      );
    }
    try {
      const meta = JSON.parse(readFileSync(CACHED_SNAPSHOT_META, "utf8")) as {
        sourceOrgSlug?: string;
        exportedAt?: string;
      };
      if (meta.sourceOrgSlug && meta.sourceOrgSlug !== sourceOrgSlug) {
        throw new Error(
          `Cached snapshot was exported from '${meta.sourceOrgSlug}', but the expected source org is '${sourceOrgSlug}'. Re-run without --cached to refresh, or set PAONIA_SOURCE_ORG_SLUG to match.`
        );
      }
      const provenance = ` (source ${meta.sourceOrgSlug ?? "?"}, exported ${meta.exportedAt ?? "?"})`;
      log(`Reusing cached Paonia snapshot ${CACHED_SNAPSHOT_FILE}${provenance}.`);
    } catch (error) {
      // A genuine org mismatch above must propagate; only swallow read/parse errors.
      if (error instanceof Error && error.message.includes("expected source org")) {
        throw error;
      }
      log(`Reusing cached Paonia snapshot ${CACHED_SNAPSHOT_FILE} (no metadata — provenance unknown).`);
    }
  } else {
    const sourceEnvFile = resolveSourceEnvFile();
    if (!sourceEnvFile) {
      throw new Error(
        [
          `Cannot seed review data: production creds not found at ${DEFAULT_SOURCE_ENV_FILE} (checked worktree and repo root).`,
          `Pull them with 'vercel env pull ${DEFAULT_SOURCE_ENV_FILE}' (or set PAONIA_SOURCE_ENV_FILE),`,
          `or re-run with --cached to reuse the last snapshot. No silent fallback to fabricated data.`,
        ].join("\n")
      );
    }
    mkdirSync(resolve(".tmp"), { recursive: true });
    log(
      `Exporting live Paonia snapshot from ${sourceOrgSlug} (real customer/order data)...`
    );
    await exportPaoniaSnapshot({
      command: "export",
      envFile: sourceEnvFile,
      orgSlug: sourceOrgSlug,
      outFile: snapshotFile,
    });
    writeFileSync(
      CACHED_SNAPSHOT_META,
      JSON.stringify(
        { sourceOrgSlug, exportedAt: new Date().toISOString() },
        null,
        2
      )
    );
  }

  // Ensure the review user/org/session exists before importing into it.
  await ensureReviewSession({ baseUrl: options.baseUrl, log });

  log(
    `Importing snapshot into ${REVIEW_ORG_SLUG} (review org only — does NOT touch test-org). Replaces existing review rows.`
  );
  await importPaoniaSnapshot({
    command: "import",
    envFile: ".env.local",
    orgSlug: REVIEW_ORG_SLUG,
    inFile: snapshotFile,
    apply: true,
    confirm: REVIEW_ORG_SLUG,
  });

  log(`Review org ${REVIEW_ORG_SLUG} seeded.`);
}

if (process.argv[1]?.endsWith("seed-review-org.ts")) {
  const cached = process.argv.includes("--cached");
  const baseUrl = process.env.TEST_BASE_URL ?? "http://localhost:3000";
  seedReviewOrg({ baseUrl, cached }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
