import { loadWorktreeEnv } from "./load-worktree-env";

loadWorktreeEnv();

type ProjectionDiff = {
  itemDeltas: unknown[];
  lotDeltas: unknown[];
  reservationDeltas: unknown[];
  expectedDeltas: unknown[];
  legacyLotDeltas: unknown[];
};

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

function summarizeDiff(diff: ProjectionDiff) {
  return {
    itemDeltas: diff.itemDeltas.length,
    lotDeltas: diff.lotDeltas.length,
    reservationDeltas: diff.reservationDeltas.length,
    expectedDeltas: diff.expectedDeltas.length,
    legacyLotDeltas: diff.legacyLotDeltas.length,
  };
}

async function main() {
  const orgId = getArgValue("--org-id");
  const itemIds = getArgValues("--item-id");
  const json = process.argv.includes("--json");

  if (!orgId) {
    console.error("Usage: pnpm diff:projections -- --org-id <org-id> [--item-id <id> ...] [--json]");
    process.exit(1);
  }

  const { diffInventoryStateForOrg } = await import(
    "@/lib/inventory/kernel/monitoring"
  );

  const result = await diffInventoryStateForOrg(
    orgId,
    itemIds.length > 0 ? itemIds : undefined
  );
  const diff = result.diff;
  const summary = summarizeDiff(diff);
  const hasDrift = !result.ok;

  if (json) {
    console.log(JSON.stringify({ ok: !hasDrift, summary, diff }, null, 2));
  } else {
    console.log(`Projection diff for org ${orgId}`);
    console.log(`- item deltas: ${summary.itemDeltas}`);
    console.log(`- lot deltas: ${summary.lotDeltas}`);
    console.log(`- reservation deltas: ${summary.reservationDeltas}`);
    console.log(`- expected deltas: ${summary.expectedDeltas}`);
    console.log(`- legacy lot deltas: ${summary.legacyLotDeltas}`);

    if (hasDrift) {
      console.log("");
      console.log(JSON.stringify(diff, null, 2));
    }
  }

  process.exit(hasDrift ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
