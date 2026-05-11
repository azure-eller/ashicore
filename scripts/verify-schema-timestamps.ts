import { readFileSync } from "node:fs";
import { relative } from "node:path";

const ERP_SCHEMA_FILES = [
  "lib/db/schema/bom.ts",
  "lib/db/schema/inventory-events.ts",
  "lib/db/schema/inventory-idempotency.ts",
  "lib/db/schema/inventory-projections.ts",
  "lib/db/schema/items.ts",
  "lib/db/schema/locations.ts",
  "lib/db/schema/lots.ts",
  "lib/db/schema/manufacturing.ts",
  "lib/db/schema/purchasing.ts",
  "lib/db/schema/quality-disposition-events.ts",
  "lib/db/schema/sales.ts",
  "lib/db/schema/stocktakes.ts",
  "lib/db/schema/units.ts",
  "lib/db/schema/xero.ts",
];

const TIMESTAMP_CALL_PATTERN =
  /timestamp\(\s*"([^"]*_at)"\s*(?:,\s*({[^)]*}))?\)/g;

const violations: Array<{ file: string; column: string }> = [];

for (const file of ERP_SCHEMA_FILES) {
  const source = readFileSync(file, "utf8");

  for (const match of source.matchAll(TIMESTAMP_CALL_PATTERN)) {
    const [, column, options] = match;

    if (!options?.includes("withTimezone: true")) {
      violations.push({
        file: relative(process.cwd(), file),
        column,
      });
    }
  }
}

if (violations.length > 0) {
  console.error("Schema timestamp verification failed.");
  console.error("ERP-owned *_at columns must use timestamp(..., { withTimezone: true }).");

  for (const violation of violations) {
    console.error(`- ${violation.file}: ${violation.column}`);
  }

  process.exit(1);
}

console.log("Schema timestamp verification passed.");
