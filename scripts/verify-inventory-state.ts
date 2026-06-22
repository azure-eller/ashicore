import { readTestEnv } from "../test/helpers/test-env";
import { loadWorktreeEnv } from "./load-worktree-env";

loadWorktreeEnv();

async function main() {
  const { TEST_ORG_ID } = readTestEnv();
  const {
    checkInventoryPlanningIntegrityForOrg,
    diffInventoryStateForOrg,
  } = await import(
    "@/lib/inventory/kernel/monitoring"
  );
  const result = await diffInventoryStateForOrg(TEST_ORG_ID);
  const planningIntegrity = await checkInventoryPlanningIntegrityForOrg(TEST_ORG_ID);

  console.log(`Inventory projection diff for org ${TEST_ORG_ID}`);
  console.log(`- item deltas: ${result.summary.itemDeltas}`);
  console.log(`- lot deltas: ${result.summary.lotDeltas}`);
  console.log(`- demand deltas: ${result.summary.demandDeltas}`);
  console.log(`- expected deltas: ${result.summary.expectedDeltas}`);
  console.log(`- legacy lot deltas: ${result.summary.legacyLotDeltas}`);
  console.log(`- negative demand references: ${planningIntegrity.summary.negativeDemandReferences}`);
  console.log(`- negative expected references: ${planningIntegrity.summary.negativeExpectedReferences}`);
  console.log(`- orphan demand references: ${planningIntegrity.summary.orphanDemandReferences}`);
  console.log(`- orphan expected references: ${planningIntegrity.summary.orphanExpectedReferences}`);
  console.log(`- inactive demand references: ${planningIntegrity.summary.inactiveDemandReferences}`);
  console.log(`- inactive expected references: ${planningIntegrity.summary.inactiveExpectedReferences}`);
  console.log(`- over-target demand references: ${planningIntegrity.summary.overTargetDemandReferences}`);
  console.log(`- over-target expected references: ${planningIntegrity.summary.overTargetExpectedReferences}`);

  if (!result.ok || !planningIntegrity.ok) {
    console.log("");
    console.log(JSON.stringify({
      projectionDiff: result.diff,
      planningIntegrity: planningIntegrity.violations,
    }, null, 2));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
