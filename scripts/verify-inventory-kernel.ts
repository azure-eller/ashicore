import { execFileSync } from "node:child_process";

type Guard = {
  pattern: string;
  allowed: string[];
  description: string;
};

const SEARCH_ROOTS = ["app", "lib", "scripts", "test"];
const EXCLUDED_GLOBS = ["!test/scenarios/**"];

const GUARDS: Guard[] = [
  {
    pattern: "recomputeCommittedQty",
    allowed: ["scripts/verify-inventory-kernel.ts"],
    description: "legacy committed-qty recompute helper must be removed",
  },
  {
    pattern: "recomputeExpectedQty",
    allowed: ["scripts/verify-inventory-kernel.ts"],
    description: "legacy expected-qty recompute helper must be removed",
  },
  {
    pattern: "createPositiveLotAndMovementInTx",
    allowed: ["scripts/verify-inventory-kernel.ts"],
    description: "legacy positive-stock helper must be removed",
  },
  {
    pattern: "fifoConsumeStockInTx",
    allowed: ["scripts/verify-inventory-kernel.ts"],
    description: "legacy FIFO helper must be removed",
  },
  {
    pattern: "applyStockDeltaInTx",
    allowed: ["scripts/verify-inventory-kernel.ts"],
    description: "legacy stock delta helper must be removed",
  },
  {
    pattern: "stockMovements",
    allowed: ["scripts/verify-inventory-kernel.ts"],
    description: "legacy stock movements table must be removed from active code",
  },
  {
    pattern: "items.committedQty",
    allowed: ["scripts/verify-inventory-kernel.ts"],
    description: "active code must read committed quantity from projections",
  },
  {
    pattern: "items.expectedQty",
    allowed: ["scripts/verify-inventory-kernel.ts"],
    description: "active code must read expected quantity from projections",
  },
  {
    pattern: "lots.costPerUnit",
    allowed: ["scripts/verify-inventory-kernel.ts"],
    description: "active code must read lot cost from inventory_lot_balances",
  },
  {
    pattern: "lots.quantity",
    allowed: [
      "lib/db/schema/lots.ts",
      "lib/inventory/kernel/operations/stock-core.ts",
      "lib/inventory/kernel/reconcile.ts",
      "scripts/verify-inventory-kernel.ts",
      "test/",
    ],
    description: "raw lots.quantity references should only remain in legacy sync code or tests",
  },
  {
    pattern: "committed_qty",
    allowed: [
      "lib/db/schema/inventory-projections.ts",
      "scripts/verify-inventory-kernel.ts",
    ],
    description: "raw committed_qty references should only exist in projection schema",
  },
  {
    pattern: "expected_qty",
    allowed: [
      "lib/db/schema/inventory-projections.ts",
      "lib/db/schema/stocktakes.ts",
      "scripts/verify-inventory-kernel.ts",
      "test/e2e/reconciliation/global-invariants.spec.ts",
    ],
    description: "raw expected_qty references should only exist in projection and stocktake snapshot schema",
  },
  {
    pattern: "cost_per_unit",
    allowed: [
      "lib/db/schema/manufacturing.ts",
      "lib/db/schema/inventory-projections.ts",
      "scripts/verify-inventory-kernel.ts",
    ],
    description: "raw cost_per_unit references should only exist in manufacturing snapshots and projections",
  },
];

function listFilesForPattern(pattern: string) {
  try {
    const output = execFileSync(
      "rg",
      [
        "-l",
        "-F",
        pattern,
        ...EXCLUDED_GLOBS.flatMap((glob) => ["--glob", glob]),
        ...SEARCH_ROOTS,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    ).trim();

    if (!output) {
      return [];
    }

    return output.split("\n").filter(Boolean).sort();
  } catch (error) {
    const exitCode =
      typeof error === "object" && error && "status" in error
        ? (error as { status?: number }).status
        : undefined;

    if (exitCode === 1) {
      return [];
    }

    throw error;
  }
}

function isAllowed(file: string, allowed: string[]) {
  return allowed.some((entry) =>
    entry.endsWith("/") ? file.startsWith(entry) : file === entry
  );
}

async function main() {
  const violations: Array<{
    pattern: string;
    description: string;
    files: string[];
  }> = [];

  for (const guard of GUARDS) {
    const files = listFilesForPattern(guard.pattern);
    const disallowed = files.filter((file) => !isAllowed(file, guard.allowed));

    if (disallowed.length > 0) {
      violations.push({
        pattern: guard.pattern,
        description: guard.description,
        files: disallowed,
      });
    }
  }

  if (violations.length === 0) {
    console.log("Inventory kernel verification passed.");
    return;
  }

  console.error("Inventory kernel verification failed.");

  for (const violation of violations) {
    console.error("");
    console.error(`Pattern: ${violation.pattern}`);
    console.error(`Rule: ${violation.description}`);

    for (const file of violation.files) {
      console.error(`- ${file}`);
    }
  }

  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
