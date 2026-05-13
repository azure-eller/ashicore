import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Client } from "pg";
import { loadWorktreeEnv } from "./load-worktree-env";

type Journal = {
  entries: Array<{
    tag: string;
    when: number;
  }>;
};

type ExpectedColumn = {
  schema: string;
  table: string;
  column: string;
  dataType?: string;
  numericPrecision?: number;
  numericScale?: number;
  isNullable?: "YES" | "NO";
  columnDefaultIncludes?: string;
};

const expectedColumns: ExpectedColumn[] = [
  {
    schema: "inventory",
    table: "items",
    column: "xero_purchase_account_code",
    dataType: "character varying",
  },
  {
    schema: "purchasing",
    table: "purchase_orders",
    column: "shipping_cost",
    dataType: "numeric",
    numericPrecision: 12,
    numericScale: 4,
    isNullable: "NO",
    columnDefaultIncludes: "0",
  },
  {
    schema: "purchasing",
    table: "purchase_orders",
    column: "xero_purchase_account_code",
    dataType: "character varying",
  },
  { schema: "purchasing", table: "purchase_orders", column: "ship_line1" },
  { schema: "purchasing", table: "purchase_orders", column: "ship_line2" },
  { schema: "purchasing", table: "purchase_orders", column: "ship_city" },
  { schema: "purchasing", table: "purchase_orders", column: "ship_region" },
  { schema: "purchasing", table: "purchase_orders", column: "ship_postcode" },
  { schema: "purchasing", table: "purchase_orders", column: "ship_country" },
  {
    schema: "purchasing",
    table: "purchase_order_lines",
    column: "xero_purchase_account_code",
    dataType: "character varying",
  },
  {
    schema: "purchasing",
    table: "purchase_order_additional_costs",
    column: "id",
    isNullable: "NO",
  },
  {
    schema: "purchasing",
    table: "purchase_order_additional_costs",
    column: "organization_id",
    isNullable: "NO",
  },
  {
    schema: "purchasing",
    table: "purchase_order_additional_costs",
    column: "purchase_order_id",
    isNullable: "NO",
  },
  {
    schema: "purchasing",
    table: "purchase_order_additional_costs",
    column: "cost_type",
    isNullable: "NO",
  },
  {
    schema: "purchasing",
    table: "purchase_order_additional_costs",
    column: "reference",
  },
  {
    schema: "purchasing",
    table: "purchase_order_additional_costs",
    column: "distribution_method",
    isNullable: "NO",
  },
  {
    schema: "purchasing",
    table: "purchase_order_additional_costs",
    column: "xero_purchase_account_code",
    dataType: "character varying",
  },
  {
    schema: "purchasing",
    table: "purchase_order_additional_costs",
    column: "amount",
    dataType: "numeric",
    numericPrecision: 12,
    numericScale: 4,
    isNullable: "NO",
  },
  {
    schema: "purchasing",
    table: "purchase_order_additional_costs",
    column: "sort_order",
    isNullable: "NO",
  },
  {
    schema: "purchasing",
    table: "purchase_order_additional_costs",
    column: "created_at",
    dataType: "timestamp with time zone",
    isNullable: "NO",
  },
  {
    schema: "purchasing",
    table: "purchase_order_additional_costs",
    column: "updated_at",
    dataType: "timestamp with time zone",
    isNullable: "NO",
  },
];

function latestMigration() {
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as Journal;
  const latest = journal.entries.at(-1);
  if (!latest) throw new Error("Migration journal has no entries.");
  const sql = readFileSync(`drizzle/${latest.tag}.sql`);
  return {
    ...latest,
    hash: createHash("sha256").update(sql).digest("hex"),
  };
}

async function assertColumn(client: Client, expected: ExpectedColumn) {
  const result = await client.query<{
    data_type: string;
    numeric_precision: number | null;
    numeric_scale: number | null;
    is_nullable: "YES" | "NO";
    column_default: string | null;
  }>(
    `
      SELECT data_type, numeric_precision, numeric_scale, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
        AND column_name = $3
    `,
    [expected.schema, expected.table, expected.column]
  );

  if (result.rowCount !== 1) {
    throw new Error(`Missing column ${expected.schema}.${expected.table}.${expected.column}.`);
  }

  const row = result.rows[0];
  if (expected.dataType && row.data_type !== expected.dataType) {
    throw new Error(
      `${expected.schema}.${expected.table}.${expected.column} has type ${row.data_type}, expected ${expected.dataType}.`
    );
  }

  if (
    expected.numericPrecision != null &&
    row.numeric_precision !== expected.numericPrecision
  ) {
    throw new Error(
      `${expected.schema}.${expected.table}.${expected.column} has precision ${row.numeric_precision}, expected ${expected.numericPrecision}.`
    );
  }

  if (expected.numericScale != null && row.numeric_scale !== expected.numericScale) {
    throw new Error(
      `${expected.schema}.${expected.table}.${expected.column} has scale ${row.numeric_scale}, expected ${expected.numericScale}.`
    );
  }

  if (expected.isNullable && row.is_nullable !== expected.isNullable) {
    throw new Error(
      `${expected.schema}.${expected.table}.${expected.column} nullable=${row.is_nullable}, expected ${expected.isNullable}.`
    );
  }

  if (
    expected.columnDefaultIncludes &&
    !row.column_default?.includes(expected.columnDefaultIncludes)
  ) {
    throw new Error(
      `${expected.schema}.${expected.table}.${expected.column} default ${row.column_default ?? "<none>"} does not include ${expected.columnDefaultIncludes}.`
    );
  }
}

async function assertAdditionalCostTableSecurity(client: Client) {
  const table = await client.query<{
    relrowsecurity: boolean;
    relforcerowsecurity: boolean;
  }>(
    `
      SELECT relrowsecurity, relforcerowsecurity
      FROM pg_class
      JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
      WHERE pg_namespace.nspname = 'purchasing'
        AND pg_class.relname = 'purchase_order_additional_costs'
    `
  );

  if (table.rowCount !== 1) {
    throw new Error("Missing table purchasing.purchase_order_additional_costs.");
  }

  if (!table.rows[0].relrowsecurity || !table.rows[0].relforcerowsecurity) {
    throw new Error(
      "purchasing.purchase_order_additional_costs must have RLS and FORCE RLS enabled."
    );
  }

  const policy = await client.query(
    `
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'purchasing'
        AND tablename = 'purchase_order_additional_costs'
        AND policyname = 'purchase_order_additional_costs_org_isolation'
    `
  );

  if (policy.rowCount !== 1) {
    throw new Error(
      "Missing policy purchasing.purchase_order_additional_costs_org_isolation."
    );
  }
}

async function assertLatestMigrationRecorded(client: Client) {
  const latest = latestMigration();
  const result = await client.query(
    `
      SELECT 1
      FROM drizzle.__drizzle_migrations
      WHERE created_at = $1
        AND hash = $2
    `,
    [latest.when, latest.hash]
  );

  if (result.rowCount !== 1) {
    throw new Error(
      `Latest repo migration ${latest.tag} (${latest.when}, ${latest.hash}) is not recorded in drizzle.__drizzle_migrations.`
    );
  }
}

async function main() {
  loadWorktreeEnv();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for schema verification.");
  }

  const productionMode = process.argv.includes("--production");
  const client = new Client({ connectionString });

  await client.connect();
  try {
    if (productionMode) {
      await assertLatestMigrationRecorded(client);
    }

    for (const column of expectedColumns) {
      await assertColumn(client, column);
    }

    await assertAdditionalCostTableSecurity(client);
  } finally {
    await client.end();
  }

  console.log(
    productionMode
      ? "Production schema verification passed."
      : "Database schema verification passed."
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
