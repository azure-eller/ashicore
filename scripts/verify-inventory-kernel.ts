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
    description: "soft committed quantity must not be an active planning source",
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
    allowed: ["scripts/verify-inventory-kernel.ts"],
    description: "committed_qty projection column has been removed",
  },
  {
    pattern: "shortage_qty",
    allowed: ["scripts/verify-inventory-kernel.ts"],
    description: "shortage_qty projection column has been removed",
  },
  {
    pattern: "inventoryReservationsSummary",
    allowed: ["scripts/verify-inventory-kernel.ts"],
    description: "soft reservation summary table has been removed",
  },
  {
    pattern: "inventory_reservations_summary",
    allowed: ["scripts/paonia-snapshot.ts", "scripts/verify-inventory-kernel.ts"],
    description: "soft reservation summary table has been removed",
  },
  {
    pattern: "reservation_increase",
    allowed: ["scripts/paonia-snapshot.ts", "scripts/verify-inventory-kernel.ts"],
    description: "soft reservation events have been removed",
  },
  {
    pattern: "reservation_release",
    allowed: ["scripts/paonia-snapshot.ts", "scripts/verify-inventory-kernel.ts"],
    description: "soft reservation events have been removed",
  },
  {
    pattern: "reserveForSales",
    allowed: ["scripts/paonia-snapshot.ts", "scripts/verify-inventory-kernel.ts"],
    description: "sales confirmation records demand only",
  },
  {
    pattern: "releaseReservation",
    allowed: ["scripts/paonia-snapshot.ts", "scripts/verify-inventory-kernel.ts"],
    description: "sales and manufacturing release demand only",
  },
  {
    pattern: "setSalesLineStockReservation",
    allowed: ["scripts/paonia-snapshot.ts", "scripts/verify-inventory-kernel.ts"],
    description: "manual soft sales reservations have been removed",
  },
  {
    pattern: "committedToOthers",
    allowed: ["scripts/verify-inventory-kernel.ts"],
    description: "shipping warnings use demand queue conflict terminology",
  },
  {
    pattern: "commitment_conflict",
    allowed: ["scripts/verify-inventory-kernel.ts"],
    description: "shipping warnings use demand queue conflict terminology",
  },
  {
    pattern: "reservedQty",
    allowed: ["scripts/verify-inventory-kernel.ts"],
    description: "reserved quantity fields have been removed from active APIs",
  },
  {
    pattern: "expected_qty",
    allowed: [
      "lib/db/schema/inventory-projections.ts",
      "lib/db/schema/stocktakes.ts",
      "lib/inventory/untracked-lot-consolidation.ts",
      "scripts/consolidate-untracked-internal-lots.ts",
      "scripts/verify-inventory-kernel.ts",
      "test/e2e/reconciliation/global-invariants.spec.ts",
      // Names the agent_query.items_stock view columns in the query tool's
      // prompt; the view itself encodes the kernel projection (0154 migration).
      "lib/agent/chat/read-tools.ts",
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
  const searchWithGitGrep = () => {
    const output = execFileSync(
      "git",
      ["grep", "-l", "-F", pattern, "--", ...SEARCH_ROOTS],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    ).trim();

    if (!output) {
      return [];
    }

    return output
      .split("\n")
      .filter(Boolean)
      .filter((file) => !file.startsWith("test/scenarios/"))
      .sort();
  };

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
    const code =
      typeof error === "object" && error && "code" in error
        ? (error as { code?: string }).code
        : undefined;
    const exitCode =
      typeof error === "object" && error && "status" in error
        ? (error as { status?: number }).status
        : undefined;

    if (code === "ENOENT") {
      try {
        return searchWithGitGrep();
      } catch (gitGrepError) {
        const gitGrepExitCode =
          typeof gitGrepError === "object" && gitGrepError && "status" in gitGrepError
            ? (gitGrepError as { status?: number }).status
            : undefined;

        if (gitGrepExitCode === 1) {
          return [];
        }

        throw gitGrepError;
      }
    }

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
