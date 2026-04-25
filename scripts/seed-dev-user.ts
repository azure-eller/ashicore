import { loadWorktreeEnv } from "./load-worktree-env";

loadWorktreeEnv();

async function main() {
  const { ensureTestAccount } = await import(
    "../test/helpers/test-account-setup"
  );
  const { TEST_ACCOUNT_EMAIL, TEST_ACCOUNT_PASSWORD } = await import(
    "../test/helpers/test-account"
  );

  const result = await ensureTestAccount({ log: console.log });

  console.log("");
  console.log(`Login: ${TEST_ACCOUNT_EMAIL}`);
  console.log(`Password: ${TEST_ACCOUNT_PASSWORD}`);
  console.log(`URL: ${result.baseUrl}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
