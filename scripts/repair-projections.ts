import { loadWorktreeEnv } from "./load-worktree-env";

loadWorktreeEnv();

function getArgValue(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }

  return process.argv[index + 1] ?? null;
}

function getArgValues(flag: string) {
  const values: string[] = [];

  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === flag && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
    }
  }

  return values;
}

function printUsage() {
  console.error(
    "Usage: pnpm repair:projections -- --org-id <org-id> [--item-id <id> ...] [--apply] [--repair-stock-ledger] [--json]"
  );
}

async function main() {
  const orgId = getArgValue("--org-id");
  const itemIds = getArgValues("--item-id");
  const apply = process.argv.includes("--apply");
  const repairStockLedger = process.argv.includes("--repair-stock-ledger");
  const json = process.argv.includes("--json");

  if (!orgId) {
    printUsage();
    process.exit(1);
  }

  const { repairInventoryStockProjectionsForOrg } = await import(
    "@/lib/inventory/kernel/repair-projections"
  );

  const result = await repairInventoryStockProjectionsForOrg(orgId, {
    apply,
    repairStockLedger,
    itemIds: itemIds.length > 0 ? itemIds : undefined,
  });
  const hasRemainingStockDrift =
    result.afterSummary.itemDeltas > 0 ||
    result.afterSummary.lotDeltas > 0 ||
    result.afterSummary.legacyLotDeltas > 0;
  const hasPlanningDrift =
    result.afterSummary.demandDeltas > 0 ||
    result.afterSummary.expectedDeltas > 0;

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Projection repair for org ${orgId}`);
    console.log(`- mode: ${result.mode}`);
    console.log(`- scoped item ids: ${itemIds.length || "all"}`);
    console.log(`- repair stock ledger: ${repairStockLedger ? "yes" : "no"}`);
    console.log("- before:");
    console.log(`  - item deltas: ${result.beforeSummary.itemDeltas}`);
    console.log(`  - lot deltas: ${result.beforeSummary.lotDeltas}`);
    console.log(`  - legacy lot deltas: ${result.beforeSummary.legacyLotDeltas}`);
    console.log(`  - demand deltas: ${result.beforeSummary.demandDeltas}`);
    console.log(`  - expected deltas: ${result.beforeSummary.expectedDeltas}`);
    console.log("- repaired:");
    console.log(`  - item rows: ${result.repaired.itemRows}`);
    console.log(`  - lot rows: ${result.repaired.lotRows}`);
    console.log(`  - legacy lot rows: ${result.repaired.legacyLotRows}`);
    console.log("- after:");
    console.log(`  - item deltas: ${result.afterSummary.itemDeltas}`);
    console.log(`  - lot deltas: ${result.afterSummary.lotDeltas}`);
    console.log(`  - legacy lot deltas: ${result.afterSummary.legacyLotDeltas}`);
    console.log(`  - demand deltas: ${result.afterSummary.demandDeltas}`);
    console.log(`  - expected deltas: ${result.afterSummary.expectedDeltas}`);

    if (!apply) {
      console.log("");
      console.log("Dry run only. Re-run with --apply to write item and legacy lot projection repairs.");
      console.log("Add --repair-stock-ledger only when raw stock events are known to be the intended source of truth for lot rows.");
    }

    if (
      apply &&
      !repairStockLedger &&
      (result.afterSummary.lotDeltas > 0 || result.afterSummary.legacyLotDeltas > 0)
    ) {
      console.log("");
      console.log("Raw stock-ledger lot drift remains diagnostic-only.");
      console.log("Default repair keeps current lot balances as the stock source of truth.");
      console.log("Add --repair-stock-ledger only after confirming raw stock events should overwrite lot rows.");
    }

    if (hasPlanningDrift) {
      console.log("");
      console.log("Demand/expected drift remains diagnostic-only; repair it with compensating kernel events.");
    }
  }

  process.exit(hasRemainingStockDrift ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
