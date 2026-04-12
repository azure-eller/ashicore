import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { Client } from "pg";
import {
  DEFAULT_ADMIN_URL,
  DEFAULT_APP_PASSWORD,
  DEFAULT_APP_USER,
  WORKTREE_ENV_HEADER,
  deriveDatabaseName,
  ensureLocalPostgresAvailable,
  getCommonRepoRoot,
  getGitTopLevel,
  quoteIdentifier,
  quoteLiteral,
  resolveComposeDir,
} from "./local-db";

function replaceDatabaseName(connectionString: string, databaseName: string) {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function buildAppUrl(connectionString: string, username: string, password: string) {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}

function upsertEnvValue(content: string, key: string, value: string) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");

  if (pattern.test(content)) {
    return content.replace(pattern, () => line);
  }

  if (content.length > 0 && !content.endsWith("\n")) {
    return `${content}\n${line}\n`;
  }

  return `${content}${line}\n`;
}

async function ensureAppRole(client: Client, roleName: string, password: string) {
  const existingRole = await client.query<{ exists: number }>(
    "SELECT 1 AS exists FROM pg_roles WHERE rolname = $1",
    [roleName]
  );

  if (existingRole.rowCount === 0) {
    await client.query(
      `CREATE ROLE ${quoteIdentifier(roleName)} WITH LOGIN PASSWORD ${quoteLiteral(password)}`
    );
    return;
  }

  await client.query(
    `ALTER ROLE ${quoteIdentifier(roleName)} WITH LOGIN PASSWORD ${quoteLiteral(password)}`
  );
}

async function ensureDatabase(client: Client, databaseName: string, ownerName: string) {
  const existingDatabase = await client.query<{ exists: number }>(
    "SELECT 1 AS exists FROM pg_database WHERE datname = $1",
    [databaseName]
  );

  if (existingDatabase.rowCount === 0) {
    await client.query(
      `CREATE DATABASE ${quoteIdentifier(databaseName)} OWNER ${quoteIdentifier(ownerName)}`
    );
  }
}

function writeWorktreeEnv(envPath: string, ownerUrl: string, appUrl: string) {
  const existingContent = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const baseContent =
    existingContent.length > 0 ? existingContent : WORKTREE_ENV_HEADER;
  const withOwnerUrl = upsertEnvValue(baseContent, "DATABASE_URL", ownerUrl);
  const withAppUrl = upsertEnvValue(withOwnerUrl, "DATABASE_URL_APP", appUrl);
  writeFileSync(envPath, withAppUrl);
}

async function main() {
  const worktreeRoot = getGitTopLevel();
  const adminUrl = process.env.LOCAL_DB_ADMIN_URL ?? DEFAULT_ADMIN_URL;
  const appUser = process.env.LOCAL_DB_APP_USER ?? DEFAULT_APP_USER;
  const appPassword = process.env.LOCAL_DB_APP_PASSWORD ?? DEFAULT_APP_PASSWORD;
  const databaseName = deriveDatabaseName(worktreeRoot);
  const ownerUrl = replaceDatabaseName(adminUrl, databaseName);
  const appUrl = buildAppUrl(ownerUrl, appUser, appPassword);
  const envPath = resolve(worktreeRoot, ".env.local");
  const composeDir = resolveComposeDir(
    worktreeRoot,
    getCommonRepoRoot(worktreeRoot)
  );
  const adminClient = new Client({ connectionString: adminUrl });

  await ensureLocalPostgresAvailable(adminUrl, composeDir);
  await adminClient.connect();

  try {
    const ownerName = new URL(adminUrl).username || "postgres";

    await ensureAppRole(adminClient, appUser, appPassword);
    await ensureDatabase(adminClient, databaseName, ownerName);
    await adminClient.query(
      `GRANT CONNECT ON DATABASE ${quoteIdentifier(databaseName)} TO ${quoteIdentifier(appUser)}`
    );
  } finally {
    await adminClient.end();
  }

  writeWorktreeEnv(envPath, ownerUrl, appUrl);

  execFileSync("pnpm", ["drizzle-kit", "migrate"], {
    cwd: worktreeRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: ownerUrl,
      DATABASE_URL_APP: appUrl,
    },
  });

  console.log("");
  console.log(`Local DB ready for ${basename(worktreeRoot)}.`);
  console.log(`Database: ${databaseName}`);
  console.log(`Worktree env: ${envPath}`);
  console.log("DATABASE_URL and DATABASE_URL_APP now point to local Postgres.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
