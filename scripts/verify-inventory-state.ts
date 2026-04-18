import { readTestEnv } from "../test/helpers/test-env";
import { loadWorktreeEnv } from "./load-worktree-env";

loadWorktreeEnv();

async function main() {
  const { TEST_ORG_ID } = readTestEnv();
  const { diffInventoryStateForOrg } = await import(
    "@/lib/inventory/kernel/monitoring"
  );
  const result = await diffInventoryStateForOrg(TEST_ORG_ID);

  console.log(`Inventory projection diff for org ${TEST_ORG_ID}`);
  console.log(`- item deltas: ${result.summary.itemDeltas}`);
  console.log(`- lot deltas: ${result.summary.lotDeltas}`);
  console.log(`- reservation deltas: ${result.summary.reservationDeltas}`);
  console.log(`- expected deltas: ${result.summary.expectedDeltas}`);
  console.log(`- legacy lot deltas: ${result.summary.legacyLotDeltas}`);

  if (!result.ok) {
    console.log("");
    console.log(JSON.stringify(result.diff, null, 2));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
