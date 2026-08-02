import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { URL } from "node:url";
import { parse as parseEnv } from "dotenv";
import { Client, type QueryResult } from "pg";

const TARGET = {
  neonProjectId: "wispy-haze-20532517",
  neonBranchId: "br-bitter-base-ai1tevx2",
  database: "neondb",
  ownerRole: "neondb_owner",
  vercelProjectId: "prj_M6zvmzh8NgNQPvKbM4zQWTmTFgfy",
  vercelTeamId: "team_2KdVcduwgDF7TpfBP5bKnhZo",
  vercelProjectName: "erp",
} as const;

type Args = {
  orgSlug: string;
  sqlFile: string;
  verifySqlFile?: string;
  envFile?: string;
  write: boolean;
  owner: boolean;
  noTransaction: boolean;
  skipCheckpoint: boolean;
};

type DbIdentity = {
  host: string;
  database: string;
  urlRole: string;
  local: boolean;
};

function parseArgs(argv: string[]): Args {
  if (argv[0] === "--") argv = argv.slice(1);

  const args: Partial<Args> = {
    write: false,
    owner: false,
    noTransaction: false,
    skipCheckpoint: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[++index];
      if (!next) throw new Error(`${arg} requires a value.`);
      return next;
    };

    if (arg === "--org-slug") args.orgSlug = value();
    else if (arg === "--sql-file") args.sqlFile = value();
    else if (arg === "--verify-sql-file") args.verifySqlFile = value();
    else if (arg === "--env-file") args.envFile = value();
    else if (arg === "--write") args.write = true;
    else if (arg === "--owner") args.owner = true;
    else if (arg === "--no-transaction") args.noTransaction = true;
    else if (arg === "--skip-checkpoint") args.skipCheckpoint = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.orgSlug) throw new Error("--org-slug is required.");
  if (!args.sqlFile) throw new Error("--sql-file is required.");
  if (args.noTransaction && !args.write) {
    throw new Error("--no-transaction requires --write.");
  }
  if (args.verifySqlFile && !args.write) {
    throw new Error("--verify-sql-file requires --write.");
  }

  return args as Args;
}

function printHelp() {
  console.log(`Usage:
  pnpm ops:production-db -- --org-slug <slug> --sql-file <path>
  pnpm ops:production-db -- --org-slug <slug> --sql-file <path> --write

Options:
  --env-file <path>     Use an existing env file instead of pulling Vercel.
  --verify-sql-file <path>
                        After a write, verify the committed result read-only.
  --write               Execute in write mode. Default is READ ONLY.
  --owner               Use DATABASE_URL instead of DATABASE_URL_APP.
  --no-transaction      Do not wrap an approved write in a transaction.
  --skip-checkpoint     Skip the best-effort Neon recovery branch.
`);
}

function loadEnvFile(path: string) {
  return parseEnv(readFileSync(resolve(path), "utf8"));
}

function pullProductionEnv() {
  const directory = mkdtempSync(join(tmpdir(), "ashicore-production-db-"));
  try {
    const vercelDirectory = join(directory, ".vercel");
    mkdirSync(vercelDirectory);
    writeFileSync(
      join(vercelDirectory, "project.json"),
      JSON.stringify({
        projectId: TARGET.vercelProjectId,
        orgId: TARGET.vercelTeamId,
        projectName: TARGET.vercelProjectName,
      })
    );

    const envPath = join(directory, ".env.production.local");
    const command = [
      "env",
      "pull",
      envPath,
      "--environment=production",
      "--yes",
      "--no-color",
      "--cwd",
      directory,
    ];
    if (process.env.VERCEL_TOKEN) {
      command.push("--token", process.env.VERCEL_TOKEN);
    }

    const result = spawnSync("vercel", command, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
    if (result.status !== 0) {
      throw new Error(
        `Unable to pull the ERP production environment from Vercel: ${sanitizedError(result.stderr || result.stdout)}`
      );
    }

    return loadEnvFile(envPath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function sanitizedError(value: string) {
  return value
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/(?:napi|sntrys|vcp)_[A-Za-z0-9_-]+/g, "[REDACTED_TOKEN]")
    .trim();
}

function databaseUrl(env: Record<string, string>, owner: boolean) {
  const key = owner ? "DATABASE_URL" : "DATABASE_URL_APP";
  const value = env[key];
  if (!value) throw new Error(`${key} is missing from the selected environment.`);
  return value;
}

function identifyDatabase(connectionString: string): DbIdentity {
  const url = new URL(connectionString);
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  return {
    host: url.hostname,
    database: url.pathname.replace(/^\//, ""),
    urlRole: decodeURIComponent(url.username),
    local,
  };
}

function runNeonctl(args: string[]) {
  const result = spawnSync("pnpm", ["dlx", "neonctl", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(sanitizedError(result.stderr || result.stdout));
  }
  return result.stdout;
}

function validateNeonEndpoint(identity: DbIdentity) {
  if (identity.local) {
    if (process.env.ERP_OPS_ALLOW_LOCAL_DATABASE !== "1") {
      throw new Error(
        "Refusing a local database. Set ERP_OPS_ALLOW_LOCAL_DATABASE=1 only for local verification."
      );
    }
    return;
  }

  if (!identity.host.endsWith(".neon.tech")) {
    throw new Error(`Expected a Neon host; got ${identity.host}.`);
  }
  if (identity.database !== TARGET.database) {
    throw new Error(
      `Expected database ${TARGET.database}; got ${identity.database || "(empty)"}.`
    );
  }

  const raw = runNeonctl([
    "api",
    `/projects/${TARGET.neonProjectId}/endpoints`,
    "--output",
    "json",
  ]);
  const response = JSON.parse(raw) as {
    endpoints?: Array<{
      branch_id: string;
      host?: string;
      hosts?: { read_write_host?: string; read_write_pooled_host?: string };
    }>;
  };
  const endpoint = response.endpoints?.find((candidate) => {
    const hosts = [
      candidate.host,
      candidate.hosts?.read_write_host,
      candidate.hosts?.read_write_pooled_host,
    ];
    return hosts.includes(identity.host);
  });
  if (!endpoint) {
    throw new Error(`Host ${identity.host} is not an endpoint in the ERP Neon project.`);
  }
  if (endpoint.branch_id !== TARGET.neonBranchId) {
    throw new Error(
      `Expected production branch ${TARGET.neonBranchId}; host maps to ${endpoint.branch_id}.`
    );
  }
}

function assertSingleStatement(sql: string, label: string) {
  let sanitized = "";
  let index = 0;
  while (index < sql.length) {
    if (sql.startsWith("--", index)) {
      const end = sql.indexOf("\n", index + 2);
      index = end === -1 ? sql.length : end;
      sanitized += " ";
      continue;
    }
    if (sql.startsWith("/*", index)) {
      const end = sql.indexOf("*/", index + 2);
      if (end === -1) throw new Error(`${label} contains an unterminated comment.`);
      index = end + 2;
      sanitized += " ";
      continue;
    }
    const character = sql[index];
    if (character === "'" || character === '"') {
      const quote = character;
      sanitized += " ";
      index += 1;
      while (index < sql.length) {
        if (sql[index] === quote) {
          if (sql[index + 1] === quote) {
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    if (character === "$" && /^\$[A-Za-z_0-9]*\$/.test(sql.slice(index))) {
      const delimiter = sql.slice(index).match(/^\$[A-Za-z_0-9]*\$/)?.[0];
      if (!delimiter) throw new Error(`${label} contains invalid dollar quoting.`);
      const end = sql.indexOf(delimiter, index + delimiter.length);
      if (end === -1) throw new Error(`${label} contains unterminated dollar quoting.`);
      sanitized += " ";
      index = end + delimiter.length;
      continue;
    }
    sanitized += character;
    index += 1;
  }

  const statements = sanitized
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  if (statements.length !== 1) {
    throw new Error(`${label} must contain exactly one statement.`);
  }
  if (/^(?:begin|start\s+transaction|commit|end|rollback|abort|savepoint|release|prepare\s+transaction)\b/i.test(statements[0])) {
    throw new Error(`${label} cannot control transactions.`);
  }
}

function createCheckpoint() {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const raw = runNeonctl([
    "branches",
    "create",
    "--project-id",
    TARGET.neonProjectId,
    "--parent",
    TARGET.neonBranchId,
    "--name",
    `agent-checkpoint/${stamp}`,
    "--no-compute",
    "--expires-at",
    expiresAt.toISOString(),
    "--output",
    "json",
  ]);
  const checkpoint = JSON.parse(raw) as { branch?: { id?: string }; id?: string };
  return checkpoint.branch?.id ?? checkpoint.id ?? "created";
}

function resultsList(result: QueryResult | QueryResult[]) {
  return Array.isArray(result) ? result : [result];
}

async function execute(args: Args) {
  const sql = readFileSync(resolve(args.sqlFile), "utf8").trim();
  if (!sql) throw new Error("SQL file is empty.");
  if (!args.noTransaction) assertSingleStatement(sql, "SQL file");
  const verificationSql = args.verifySqlFile
    ? readFileSync(resolve(args.verifySqlFile), "utf8").trim()
    : undefined;
  if (args.verifySqlFile && !verificationSql) {
    throw new Error("Verification SQL file is empty.");
  }
  if (verificationSql) assertSingleStatement(verificationSql, "Verification SQL file");

  const env = args.envFile ? loadEnvFile(args.envFile) : pullProductionEnv();
  const connectionString = databaseUrl(env, args.owner);
  const identity = identifyDatabase(connectionString);
  validateNeonEndpoint(identity);

  console.log(`Target: ${identity.host}/${identity.database}`);
  console.log(`Expected Neon project: ${TARGET.neonProjectId}`);
  console.log(`Expected Neon branch: ${TARGET.neonBranchId}`);
  console.log(`Requested role: ${identity.urlRole}`);
  console.log(`Organization: ${args.orgSlug}`);
  console.log(`Mode: ${args.write ? "WRITE" : "READ ONLY"}`);
  console.log(`Transaction: ${args.noTransaction ? "caller-managed" : "single transaction"}`);
  console.log("SQL:");
  console.log(sql);

  const client = new Client({ connectionString });
  await client.connect();
  let transactionOpen = false;

  try {
    const identityResult = await client.query<{
      database: string;
      role: string;
    }>("SELECT current_database() AS database, current_user AS role");
    const actual = identityResult.rows[0];
    if (actual.database !== identity.database) {
      throw new Error(`Connected database changed to ${actual.database}.`);
    }
    const expectedRole = args.owner
      ? identity.local
        ? identity.urlRole
        : TARGET.ownerRole
      : "app_user";
    if (actual.role !== expectedRole) {
      throw new Error(`Expected database role ${expectedRole}; connected as ${actual.role}.`);
    }
    console.log(`Role: ${actual.role}`);

    if (args.write && !args.skipCheckpoint && !identity.local) {
      try {
        console.log(`Recovery checkpoint: ${createCheckpoint()} (expires in 7 days)`);
      } catch (error) {
        console.warn(
          `Warning: recovery checkpoint was not created (${sanitizedError(String(error))}). Continuing with the approved write and existing PITR.`
        );
      }
    } else if (args.write) {
      console.log(
        `Recovery checkpoint: skipped${identity.local ? " (local database)" : " by request"}`
      );
    }

    const orgResult = await client.query<{ id: string; slug: string; name: string }>(
      `SELECT id, slug, name FROM system.organization WHERE slug = $1`,
      [args.orgSlug]
    );
    if (orgResult.rowCount !== 1) {
      throw new Error(`Expected one organization for slug ${args.orgSlug}.`);
    }
    const organization = orgResult.rows[0];

    if (!args.noTransaction) {
      await client.query(args.write ? "BEGIN" : "BEGIN READ ONLY");
      transactionOpen = true;
      await client.query("SET LOCAL statement_timeout = '30s'");
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [
        organization.id,
      ]);
    } else {
      await client.query("SET statement_timeout = '30s'");
      await client.query("SET lock_timeout = '5s'");
      await client.query("SELECT set_config('app.current_org_id', $1, false)", [
        organization.id,
      ]);
    }

    const result = await client.query(sql);
    const results = resultsList(result);
    if (transactionOpen) {
      await client.query("COMMIT");
      transactionOpen = false;
    }

    let affectedRows = 0;
    for (const item of results) {
      if (item.command !== "SELECT") affectedRows += item.rowCount ?? 0;
      if (item.rows.length > 0) console.log(`Rows: ${JSON.stringify(item.rows)}`);
    }
    if (args.write) console.log(`Affected rows: ${affectedRows}`);

    if (verificationSql) {
      await client.query("BEGIN READ ONLY");
      transactionOpen = true;
      await client.query("SET LOCAL statement_timeout = '30s'");
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [
        organization.id,
      ]);
      const verification = await client.query(verificationSql);
      await client.query("COMMIT");
      transactionOpen = false;
      console.log(`Verification rows: ${JSON.stringify(verification.rows)}`);
    }
    console.log("Completed successfully.");
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

execute(parseArgs(process.argv.slice(2))).catch((error) => {
  console.error(sanitizedError(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
