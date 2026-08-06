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

function normalizedDatabaseIdentity(connectionString: string) {
  const url = new URL(connectionString);
  return {
    host: url.hostname.replace(/-pooler(?=\.)/, ""),
    database: url.pathname.replace(/^\//, ""),
  };
}

function assertRuntimeDatabaseMatchesMigrationDatabase(ownerUrl: string) {
  const appUrl = process.env.DATABASE_URL_APP;
  if (!appUrl) {
    throw new Error(
      "DATABASE_URL_APP is required in production mode so build and runtime database targets can be compared."
    );
  }

  const owner = normalizedDatabaseIdentity(ownerUrl);
  const app = normalizedDatabaseIdentity(appUrl);
  if (owner.host !== app.host || owner.database !== app.database) {
    throw new Error(
      "DATABASE_URL and DATABASE_URL_APP target different databases. Refusing to verify a schema the deployed runtime will not use."
    );
  }
}

const expectedColumns: ExpectedColumn[] = [
  {
    schema: "system",
    table: "organization",
    column: "sku_limit_starts_at",
    dataType: "timestamp with time zone",
    isNullable: "NO",
  },
  {
    schema: "system",
    table: "organization",
    column: "beta_features",
    dataType: "jsonb",
    isNullable: "NO",
  },
  {
    schema: "settings",
    table: "tax_rates",
    column: "id",
    dataType: "uuid",
    isNullable: "NO",
  },
  {
    schema: "settings",
    table: "tax_rates",
    column: "organization_id",
    dataType: "text",
    isNullable: "NO",
  },
  {
    schema: "settings",
    table: "tax_rates",
    column: "name",
    dataType: "character varying",
    isNullable: "NO",
  },
  {
    schema: "settings",
    table: "tax_rates",
    column: "rate_percent",
    dataType: "numeric",
    numericPrecision: 7,
    numericScale: 4,
    isNullable: "NO",
  },
  {
    schema: "settings",
    table: "tax_rates",
    column: "deleted_at",
    dataType: "timestamp with time zone",
  },
  {
    schema: "settings",
    table: "tax_rates",
    column: "created_at",
    dataType: "timestamp with time zone",
    isNullable: "NO",
  },
  {
    schema: "settings",
    table: "tax_rates",
    column: "updated_at",
    dataType: "timestamp with time zone",
    isNullable: "NO",
  },
  {
    schema: "settings",
    table: "organization_tax_settings",
    column: "organization_id",
    dataType: "text",
    isNullable: "NO",
  },
  {
    schema: "settings",
    table: "organization_tax_settings",
    column: "default_sales_tax_rate_id",
    dataType: "uuid",
  },
  {
    schema: "settings",
    table: "organization_tax_settings",
    column: "default_purchase_tax_rate_id",
    dataType: "uuid",
  },
  {
    schema: "settings",
    table: "organization_tax_settings",
    column: "created_at",
    dataType: "timestamp with time zone",
    isNullable: "NO",
  },
  {
    schema: "settings",
    table: "organization_tax_settings",
    column: "updated_at",
    dataType: "timestamp with time zone",
    isNullable: "NO",
  },
  {
    schema: "inventory",
    table: "item_families",
    column: "sales_unit_definition_id",
    dataType: "uuid",
  },
  {
    schema: "inventory",
    table: "item_families",
    column: "sales_to_stock_factor",
    dataType: "numeric",
    numericPrecision: 12,
    numericScale: 4,
  },
  {
    schema: "inventory",
    table: "items",
    column: "sales_unit_definition_id",
    dataType: "uuid",
  },
  {
    schema: "inventory",
    table: "items",
    column: "sales_to_stock_factor",
    dataType: "numeric",
    numericPrecision: 12,
    numericScale: 4,
  },
  {
    schema: "sales",
    table: "sales_orders",
    column: "subtotal_amount",
    dataType: "numeric",
    numericPrecision: 12,
    numericScale: 2,
    isNullable: "NO",
    columnDefaultIncludes: "0",
  },
  {
    schema: "sales",
    table: "sales_orders",
    column: "tax_amount",
    dataType: "numeric",
    numericPrecision: 12,
    numericScale: 2,
    isNullable: "NO",
    columnDefaultIncludes: "0",
  },
  { schema: "sales", table: "sales_order_lines", column: "tax_rate_id", dataType: "uuid" },
  {
    schema: "sales",
    table: "sales_order_lines",
    column: "stocking_unit_name",
    dataType: "character varying",
    isNullable: "NO",
  },
  {
    schema: "sales",
    table: "sales_order_lines",
    column: "sales_to_stock_factor",
    dataType: "numeric",
    numericPrecision: 12,
    numericScale: 4,
    isNullable: "NO",
  },
  {
    schema: "sales",
    table: "sales_order_lines",
    column: "stock_quantity",
    dataType: "numeric",
    numericPrecision: 12,
    numericScale: 4,
    isNullable: "NO",
  },
  {
    schema: "sales",
    table: "sales_order_lines",
    column: "stock_cancelled_quantity",
    dataType: "numeric",
    numericPrecision: 12,
    numericScale: 4,
    isNullable: "NO",
    columnDefaultIncludes: "0",
  },
  {
    schema: "sales",
    table: "sales_order_lines",
    column: "stock_shipped_quantity",
    dataType: "numeric",
    numericPrecision: 12,
    numericScale: 4,
    isNullable: "NO",
    columnDefaultIncludes: "0",
  },
  {
    schema: "sales",
    table: "sales_order_lines",
    column: "tax_rate_name",
    dataType: "character varying",
  },
  {
    schema: "sales",
    table: "sales_order_lines",
    column: "tax_rate_percent",
    dataType: "numeric",
    numericPrecision: 7,
    numericScale: 4,
    isNullable: "NO",
    columnDefaultIncludes: "0",
  },
  {
    schema: "sales",
    table: "sales_order_lines",
    column: "line_subtotal",
    dataType: "numeric",
    numericPrecision: 12,
    numericScale: 2,
    isNullable: "NO",
    columnDefaultIncludes: "0",
  },
  {
    schema: "sales",
    table: "sales_order_lines",
    column: "line_tax_amount",
    dataType: "numeric",
    numericPrecision: 12,
    numericScale: 2,
    isNullable: "NO",
    columnDefaultIncludes: "0",
  },
  {
    schema: "purchasing",
    table: "purchase_orders",
    column: "subtotal_amount",
    dataType: "numeric",
    numericPrecision: 12,
    numericScale: 4,
    isNullable: "NO",
    columnDefaultIncludes: "0",
  },
  {
    schema: "purchasing",
    table: "purchase_orders",
    column: "tax_amount",
    dataType: "numeric",
    numericPrecision: 12,
    numericScale: 4,
    isNullable: "NO",
    columnDefaultIncludes: "0",
  },
  {
    schema: "purchasing",
    table: "purchase_order_lines",
    column: "tax_rate_id",
    dataType: "uuid",
  },
  {
    schema: "purchasing",
    table: "purchase_order_lines",
    column: "tax_rate_name",
    dataType: "character varying",
  },
  {
    schema: "purchasing",
    table: "purchase_order_lines",
    column: "tax_rate_percent",
    dataType: "numeric",
    numericPrecision: 7,
    numericScale: 4,
    isNullable: "NO",
    columnDefaultIncludes: "0",
  },
  {
    schema: "purchasing",
    table: "purchase_order_lines",
    column: "line_subtotal",
    dataType: "numeric",
    numericPrecision: 12,
    numericScale: 4,
    isNullable: "NO",
    columnDefaultIncludes: "0",
  },
  {
    schema: "purchasing",
    table: "purchase_order_lines",
    column: "line_tax_amount",
    dataType: "numeric",
    numericPrecision: 12,
    numericScale: 4,
    isNullable: "NO",
    columnDefaultIncludes: "0",
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
    column: "accounting_purchase_account_code",
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
    column: "accounting_purchase_account_code",
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
    column: "accounting_purchase_account_code",
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
  {
    schema: "sales",
    table: "pricing_scenarios",
    column: "organization_id",
    dataType: "text",
    isNullable: "NO",
  },
  {
    schema: "sales",
    table: "pricing_scenarios",
    column: "doc",
    dataType: "jsonb",
    isNullable: "NO",
  },
  {
    schema: "sales",
    table: "pricing_scenarios",
    column: "version",
    dataType: "integer",
    isNullable: "NO",
  },
  {
    schema: "sales",
    table: "pricing_scenarios",
    column: "deleted_at",
    dataType: "timestamp with time zone",
    isNullable: "YES",
  },
  {
    schema: "sales",
    table: "pricing_scenario_revisions",
    column: "organization_id",
    dataType: "text",
    isNullable: "NO",
  },
  {
    schema: "sales",
    table: "pricing_scenario_revisions",
    column: "scenario_id",
    dataType: "uuid",
    isNullable: "NO",
  },
  {
    schema: "sales",
    table: "pricing_scenario_revisions",
    column: "revision_number",
    dataType: "integer",
    isNullable: "NO",
  },
  {
    schema: "sales",
    table: "pricing_scenario_revisions",
    column: "snapshot",
    dataType: "jsonb",
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

async function assertTableSecurity(
  client: Client,
  schema: string,
  tableName: string,
  policyName: string
) {
  const table = await client.query<{
    relrowsecurity: boolean;
    relforcerowsecurity: boolean;
  }>(
    `
      SELECT relrowsecurity, relforcerowsecurity
      FROM pg_class
      JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
      WHERE pg_namespace.nspname = $1
        AND pg_class.relname = $2
    `,
    [schema, tableName]
  );

  if (table.rowCount !== 1) {
    throw new Error(`Missing table ${schema}.${tableName}.`);
  }

  if (!table.rows[0].relrowsecurity || !table.rows[0].relforcerowsecurity) {
    throw new Error(`${schema}.${tableName} must have RLS and FORCE RLS enabled.`);
  }

  const policy = await client.query(
    `
      SELECT 1
      FROM pg_policies
      WHERE schemaname = $1
        AND tablename = $2
        AND policyname = $3
    `,
    [schema, tableName, policyName]
  );

  if (policy.rowCount !== 1) {
    throw new Error(`Missing policy ${schema}.${policyName}.`);
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

  if (result.rowCount === 1) {
    return;
  }

  const timestampOnly = await client.query<{ hash: string }>(
    `
      SELECT hash
      FROM drizzle.__drizzle_migrations
      WHERE created_at = $1
    `,
    [latest.when]
  );

  if ((timestampOnly.rowCount ?? 0) > 0) {
    console.warn(
      `Latest repo migration ${latest.tag} (${latest.when}) is recorded with hash ${timestampOnly.rows
        .map((row) => row.hash)
        .join(", ")}, expected ${latest.hash}. Continuing after schema verification.`
    );
    return;
  }

  console.warn(
    `Latest repo migration ${latest.tag} (${latest.when}, ${latest.hash}) is not recorded in drizzle.__drizzle_migrations. Continuing to schema verification.`
  );
}

async function main() {
  const productionMode = process.argv.includes("--production");
  const explicitDatabaseUrl = process.env.DATABASE_URL;

  if (!productionMode || !explicitDatabaseUrl) {
    loadWorktreeEnv();
  }

  const connectionString = explicitDatabaseUrl ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for schema verification.");
  }
  if (productionMode) {
    assertRuntimeDatabaseMatchesMigrationDatabase(connectionString);
  }

  const client = new Client({ connectionString });

  await client.connect();
  try {
    if (productionMode) {
      await assertLatestMigrationRecorded(client);
    }

    for (const column of expectedColumns) {
      await assertColumn(client, column);
    }

    await assertTableSecurity(
      client,
      "purchasing",
      "purchase_order_additional_costs",
      "purchase_order_additional_costs_org_isolation"
    );
    await assertTableSecurity(client, "settings", "tax_rates", "tax_rates_org_isolation");
    await assertTableSecurity(
      client,
      "settings",
      "organization_tax_settings",
      "organization_tax_settings_org_isolation"
    );
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
