import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Snapshot = {
  tables: Record<
    string,
    {
      name: string;
      schema?: string;
      isRLSEnabled?: boolean;
    }
  >;
};

const DRIZZLE_DIR = join(process.cwd(), "drizzle");
const META_DIR = join(DRIZZLE_DIR, "meta");

function latestSnapshotPath() {
  const indices = readdirSync(META_DIR)
    .map((name) => /^(\d+)_snapshot\.json$/.exec(name)?.[1])
    .filter((value): value is string => value != null)
    .map((value) => Number(value));

  if (indices.length === 0) {
    throw new Error("No Drizzle snapshots found in drizzle/meta.");
  }

  const latest = Math.max(...indices).toString().padStart(4, "0");
  return join(META_DIR, `${latest}_snapshot.json`);
}

function normalizeSql(sql: string) {
  return sql.replace(/--.*$/gm, " ").replace(/\s+/g, " ");
}

function readMigrationSql() {
  return normalizeSql(
    readdirSync(DRIZZLE_DIR)
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .sort()
      .map((name) => readFileSync(join(DRIZZLE_DIR, name), "utf8"))
      .join("\n")
  );
}

function readRlsTables() {
  const snapshot = JSON.parse(readFileSync(latestSnapshotPath(), "utf8")) as Snapshot;
  return Object.values(snapshot.tables)
    .filter((table) => table.isRLSEnabled === true)
    .map((table) => ({
      schema: table.schema ?? "public",
      name: table.name,
    }))
    .sort((a, b) => `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`));
}

function parseSchemaSelectGrants(sql: string) {
  const grants = new Set<string>();
  const pattern =
    /GRANT\s+([^;]+?)\s+ON\s+ALL\s+TABLES\s+IN\s+SCHEMA\s+"?([a-zA-Z0-9_]+)"?\s+TO\s+"?app_user"?/gi;

  for (const match of sql.matchAll(pattern)) {
    const privileges = match[1]?.toUpperCase() ?? "";
    const schema = match[2];
    if (schema && (privileges.includes("SELECT") || privileges.includes("ALL PRIVILEGES"))) {
      grants.add(schema);
    }
  }

  return grants;
}

function parseTableSelectGrants(sql: string) {
  const grants = new Set<string>();
  const pattern =
    /GRANT\s+([^;]+?)\s+ON\s+TABLE\s+(.+?)\s+TO\s+"?app_user"?/gi;

  for (const match of sql.matchAll(pattern)) {
    const privileges = match[1]?.toUpperCase() ?? "";
    const tableList = match[2] ?? "";

    if (!privileges.includes("SELECT") && !privileges.includes("ALL PRIVILEGES")) {
      continue;
    }

    for (const tableMatch of tableList.matchAll(
      /"?([a-zA-Z0-9_]+)"?\."?([a-zA-Z0-9_]+)"?/g
    )) {
      const schema = tableMatch[1];
      const table = tableMatch[2];
      if (schema && table) {
        grants.add(`${schema}.${table}`);
      }
    }
  }

  return grants;
}

function main() {
  const sql = readMigrationSql();
  const schemaGrants = parseSchemaSelectGrants(sql);
  const tableGrants = parseTableSelectGrants(sql);
  const missing = readRlsTables().filter(
    (table) =>
      !schemaGrants.has(table.schema) && !tableGrants.has(`${table.schema}.${table.name}`)
  );

  if (missing.length > 0) {
    console.error("RLS tables missing app_user SELECT grants:");
    for (const table of missing) {
      console.error(`- ${table.schema}.${table.name}`);
    }
    console.error(
      "Add an app_user table grant in the migration, e.g. GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ..."
    );
    process.exit(1);
  }

  console.log(`app_user SELECT grants verified for ${readRlsTables().length} RLS tables.`);
}

main();
