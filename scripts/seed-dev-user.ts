import { loadWorktreeEnv } from "./load-worktree-env";

loadWorktreeEnv();

const REAL_PAONIA_ORG_SLUG = "paonia-soil-company";

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
  await loadPaoniaDevData(result.organizationId, console.log);
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
