import { loadWorktreeEnv } from "./load-worktree-env";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

loadWorktreeEnv();

const REAL_PAONIA_ORG_SLUG = "paonia-soil-company";
const DEFAULT_CURRENT_PAONIA_ENV_FILE = ".vercel/.env.production.local";

function isMfaDisabledForDevOrTest() {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  return (
    process.env.AUTH_MFA_DISABLED === "1" &&
    (nodeEnv === "development" || nodeEnv === "test")
  );
}

async function removeRealPaoniaMembership() {
  const connectionString =
    process.env.DATABASE_URL ?? process.env.DATABASE_URL_APP;

  if (!connectionString) {
    return false;
  }

  const { Client } = await import("pg");
  const { TEST_ACCOUNT_EMAIL } = await import("../test/helpers/test-account");
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const result = await client.query(
      `
        DELETE FROM system.member AS m
        USING system."user" AS u, system.organization AS o
        WHERE m.user_id = u.id
          AND m.organization_id = o.id
          AND u.email = $1
          AND o.slug = $2
      `,
      [TEST_ACCOUNT_EMAIL, REAL_PAONIA_ORG_SLUG]
    );

    return (result.rowCount ?? 0) > 0;
  } finally {
    await client.end();
  }
}

async function hasSeededSalesOrders(organizationId: string) {
  const connectionString =
    process.env.DATABASE_URL ?? process.env.DATABASE_URL_APP;

  if (!connectionString) {
    return false;
  }

  const { Client } = await import("pg");
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const result = await client.query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM sales.sales_orders
          WHERE organization_id = $1
          LIMIT 1
        ) AS exists
      `,
      [organizationId]
    );

    return result.rows[0]?.exists === true;
  } finally {
    await client.end();
  }
}

async function loadCurrentPaoniaSnapshot(targetOrgSlug: string) {
  const sourceMode = process.env.PAONIA_DEV_SEED_SOURCE ?? "snapshot";
  if (sourceMode === "loader") {
    return false;
  }
  if (!targetOrgSlug.startsWith("test-")) {
    throw new Error(
      `Refusing to import Paonia snapshot into non-test org '${targetOrgSlug}'.`
    );
  }

  const { exportPaoniaSnapshot, importPaoniaSnapshot } = await import(
    "./paonia-snapshot"
  );
  const sourceOrgSlug =
    process.env.PAONIA_SOURCE_ORG_SLUG ?? REAL_PAONIA_ORG_SLUG;
  const explicitSnapshotFile = process.env.PAONIA_SNAPSHOT_FILE;
  const snapshotFile =
    explicitSnapshotFile && explicitSnapshotFile.trim() !== ""
      ? resolve(explicitSnapshotFile)
      : resolve(".tmp", "paonia-current.json");
  let generatedSnapshot = false;

  try {
    if (!explicitSnapshotFile) {
      if (process.env.PAONIA_DEV_SEED_FROM_PRODUCTION !== "1") {
        console.log(
          "Current Paonia snapshot import is opt-in. Set PAONIA_DEV_SEED_FROM_PRODUCTION=1 to export from production; using scripted Paonia loader."
        );
        return false;
      }

      const sourceEnvFile = resolve(
        process.env.PAONIA_SOURCE_ENV_FILE ?? DEFAULT_CURRENT_PAONIA_ENV_FILE
      );
      if (!existsSync(sourceEnvFile)) {
        console.log(
          `Current Paonia snapshot source env not found at ${sourceEnvFile}; using scripted Paonia loader.`
        );
        return false;
      }

      mkdirSync(resolve(".tmp"), { recursive: true });
      console.log(
        `Exporting current Paonia snapshot from ${sourceOrgSlug}. This may include real customer/order data.`
      );
      await exportPaoniaSnapshot({
        command: "export",
        envFile: sourceEnvFile,
        orgSlug: sourceOrgSlug,
        outFile: snapshotFile,
      });
      generatedSnapshot = true;
    } else if (!existsSync(snapshotFile)) {
      console.log(
        `PAONIA_SNAPSHOT_FILE does not exist at ${snapshotFile}; using scripted Paonia loader.`
      );
      return false;
    }

    console.log(`Importing current Paonia snapshot into ${targetOrgSlug}...`);
    await importPaoniaSnapshot({
      command: "import",
      envFile: ".env.local",
      orgSlug: targetOrgSlug,
      inFile: snapshotFile,
      apply: true,
      confirm: targetOrgSlug,
    });

    return true;
  } catch (error) {
    console.log(
      `Current Paonia snapshot import failed; using scripted Paonia loader. Set PAONIA_DEV_SEED_SOURCE=loader to skip snapshot import.`
    );
    console.log(error instanceof Error ? error.message : String(error));
    return false;
  } finally {
    if (generatedSnapshot) {
      try {
        unlinkSync(snapshotFile);
      } catch (error) {
        console.warn(
          `Could not remove generated Paonia snapshot ${snapshotFile}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }
}

async function main() {
  process.env.TEST_ORG ??= "Test Paonia Soil Co.";
  process.env.TEST_ORG_SLUG ??= "test-paonia-soil-co";

  const { ensureTestAccount } = await import(
    "../test/helpers/test-account-setup"
  );
  const { TEST_ACCOUNT_EMAIL, TEST_ACCOUNT_PASSWORD } = await import(
    "../test/helpers/test-account"
  );
  const { loadPaoniaDevData } = await import("./load-paonia-dev-data");

  const result = await ensureTestAccount({ log: console.log });
  if (isMfaDisabledForDevOrTest()) {
    const connectionString =
      process.env.DATABASE_URL ?? process.env.DATABASE_URL_APP;
    if (connectionString) {
      const { Client } = await import("pg");
      const client = new Client({ connectionString });
      await client.connect();
      try {
        await client.query(
          'UPDATE system."user" SET two_factor_enabled = false, updated_at = NOW() WHERE email = $1',
          [TEST_ACCOUNT_EMAIL]
        );
      } finally {
        await client.end();
      }
    }
  }
  const loadedCurrentSnapshot = await loadCurrentPaoniaSnapshot(
    result.organizationSlug
  );
  if (!loadedCurrentSnapshot) {
    if (await hasSeededSalesOrders(result.organizationId)) {
      console.log(
        `Skipping scripted Paonia loader because ${result.organizationSlug} already has sales orders.`
      );
    } else {
      await loadPaoniaDevData(result.organizationId, console.log);
    }
  }
  const removedRealMembership = await removeRealPaoniaMembership();

  console.log("");
  if (removedRealMembership) {
    console.log(
      `Removed ${TEST_ACCOUNT_EMAIL} from ${REAL_PAONIA_ORG_SLUG}; dev seed uses ${result.organizationSlug}.`
    );
  }
  console.log(`Login: ${TEST_ACCOUNT_EMAIL}`);
  console.log(`Password: ${TEST_ACCOUNT_PASSWORD}`);
  console.log(`URL: ${result.baseUrl}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
