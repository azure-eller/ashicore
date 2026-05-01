import { loadWorktreeEnv } from "./load-worktree-env";

loadWorktreeEnv();

async function main() {
  process.env.TEST_ORG ??= "Paonia Soil Company";
  process.env.TEST_ORG_SLUG ??= "paonia-soil-company";

  const { ensureTestAccount } = await import(
    "../test/helpers/test-account-setup"
  );
  const { TEST_ACCOUNT_EMAIL, TEST_ACCOUNT_PASSWORD } = await import(
    "../test/helpers/test-account"
  );
  const { loadPaoniaDevData } = await import("./load-paonia-dev-data");

  const result = await ensureTestAccount({ log: console.log });
  await loadPaoniaDevData(result.organizationId, console.log);

  console.log("");
  console.log(`Login: ${TEST_ACCOUNT_EMAIL}`);
  console.log(`Password: ${TEST_ACCOUNT_PASSWORD}`);
  console.log(`URL: ${result.baseUrl}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
