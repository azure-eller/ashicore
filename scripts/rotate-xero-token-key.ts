import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawnSync } from "node:child_process";
import { parse as parseDotenv } from "dotenv";
import { Pool } from "pg";
import {
  decryptXeroToken,
  encryptXeroToken,
  resetXeroTokenEncryptionKeyForTests,
} from "@/lib/xero/token-crypto";

type Args = {
  apply: boolean;
  environment: string | null;
  envFile: string | null;
  newKeyId: string | null;
  newKey: string | null;
};

type EnvMap = Record<string, string>;

type KeyConfig = {
  activeKeyId: string;
  keys: Record<string, string>;
  legacyKey: string | null;
};

type XeroTokenRow = {
  id: string;
  organization_id: string;
  provider: string;
  token_encryption_key_id: string | null;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string;
};

type RotationSummary = {
  totalConnections: number;
  rowsScanned: number;
  rowsRotated: number;
  rowsAlreadyActive: number;
  rowsSkipped: number;
  decryptFailures: number;
  verifyFailures: number;
};

const BATCH_SIZE = 25;

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    apply: false,
    environment: null,
    envFile: null,
    newKeyId: null,
    newKey: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--apply") {
      args.apply = true;
    } else if (arg === "--environment") {
      if (!next) throw new Error("--environment requires a value.");
      args.environment = next;
      index += 1;
    } else if (arg === "--env-file") {
      if (!next) throw new Error("--env-file requires a value.");
      args.envFile = next;
      index += 1;
    } else if (arg === "--new-key-id") {
      if (!next) throw new Error("--new-key-id requires a value.");
      args.newKeyId = next;
      index += 1;
    } else if (arg === "--new-key") {
      if (!next) throw new Error("--new-key requires a value.");
      args.newKey = next;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printUsage() {
  console.log(`Usage:
  pnpm rotate:xero-token-key -- --environment production [--apply]

Options:
  --apply                 Perform Vercel env and DB writes. Default is dry-run.
  --environment <name>    Required. Must be production for apply mode.
  --env-file <path>       Load env from a local file instead of vercel env pull.
  --new-key-id <id>       Optional explicit new key id.
  --new-key <base64>      Optional explicit 32-byte base64 key.`);
}

function requireProductionTarget(args: Args) {
  if (args.environment !== "production") {
    throw new Error("--environment production is required for this rotation.");
  }
}

function readEnvFile(path: string): EnvMap {
  return parseDotenv(readFileSync(path));
}

function run(command: string, args: string[], inputValue?: string) {
  const result = spawnSync(command, args, {
    input: inputValue,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    throw new Error(
      `${command} ${args.join(" ")} failed${stderr ? `: ${stderr}` : stdout ? `: ${stdout}` : "."}`
    );
  }

  return result.stdout ?? "";
}

function loadVercelEnv(environment: string): EnvMap {
  const tempDir = mkdtempSync(join(tmpdir(), "erp-xero-key-rotation-"));
  const envPath = join(tempDir, ".env");

  try {
    run("vercel", ["env", "pull", envPath, `--environment=${environment}`, "--yes"]);
    return readEnvFile(envPath);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function readVercelProject() {
  try {
    const raw = readFileSync(".vercel/project.json", "utf8");
    const parsed = JSON.parse(raw) as { orgId?: string; projectId?: string };
    return {
      orgId: parsed.orgId ?? "unknown",
      projectId: parsed.projectId ?? "unknown",
    };
  } catch {
    return { orgId: "unknown", projectId: "unknown" };
  }
}

function setVercelEnv(name: string, value: string, environment: string) {
  const update = spawnSync("vercel", ["env", "update", name, environment], {
    input: `${value}\n`,
    encoding: "utf8",
  });

  if (update.status === 0) {
    return;
  }

  // `update` requires the variable to exist; `add` handles first rollout.
  run("vercel", ["env", "add", name, environment], `${value}\n`);
}

function removeVercelEnv(name: string, environment: string) {
  try {
    run("vercel", ["env", "rm", name, environment, "--yes"]);
  } catch {
    // Missing env vars are already retired.
  }
}

function validateKeyId(keyId: string) {
  if (!/^[A-Za-z0-9_.:-]+$/.test(keyId)) {
    throw new Error(
      `Invalid key id '${keyId}'. Use only letters, numbers, dots, underscores, colons, or dashes.`
    );
  }
}

function validateBase64Key(value: string, label: string) {
  if (value.trim() !== value || value.length === 0) {
    throw new Error(`${label} must be base64 without surrounding whitespace.`);
  }

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error(`${label} must be valid base64.`);
  }

  if (Buffer.from(value, "base64").length !== 32) {
    throw new Error(`${label} must decode to exactly 32 bytes.`);
  }
}

export function parseKeyConfig(env: EnvMap): KeyConfig {
  const activeKeyId = env.XERO_TOKEN_ENCRYPTION_KEY_ID?.trim() || "default";
  validateKeyId(activeKeyId);

  const rawMap = env.XERO_TOKEN_ENCRYPTION_KEYS?.trim();
  if (rawMap) {
    const parsed = JSON.parse(rawMap) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("XERO_TOKEN_ENCRYPTION_KEYS must be a JSON object.");
    }

    const keys: Record<string, string> = {};
    for (const [keyId, value] of Object.entries(parsed)) {
      validateKeyId(keyId);
      if (typeof value !== "string") {
        throw new Error(`XERO_TOKEN_ENCRYPTION_KEYS.${keyId} must be a string.`);
      }
      validateBase64Key(value, `XERO_TOKEN_ENCRYPTION_KEYS.${keyId}`);
      keys[keyId] = value;
    }

    if (!keys[activeKeyId]) {
      throw new Error("XERO_TOKEN_ENCRYPTION_KEY_ID must exist in XERO_TOKEN_ENCRYPTION_KEYS.");
    }

    return {
      activeKeyId,
      keys,
      legacyKey: env.XERO_TOKEN_ENCRYPTION_KEY?.trim() || null,
    };
  }

  const legacyKey = env.XERO_TOKEN_ENCRYPTION_KEY?.trim();
  if (!legacyKey) {
    throw new Error(
      "XERO_TOKEN_ENCRYPTION_KEYS or XERO_TOKEN_ENCRYPTION_KEY is required."
    );
  }
  validateBase64Key(legacyKey, "XERO_TOKEN_ENCRYPTION_KEY");

  return {
    activeKeyId,
    keys: { [activeKeyId]: legacyKey },
    legacyKey,
  };
}

export function createNextKeyConfig(
  current: KeyConfig,
  newKeyId: string,
  newKey: string
): KeyConfig {
  validateKeyId(newKeyId);
  validateBase64Key(newKey, "new key");

  if (current.keys[newKeyId]) {
    throw new Error(`Key id '${newKeyId}' already exists.`);
  }

  return {
    activeKeyId: newKeyId,
    keys: {
      ...current.keys,
      [newKeyId]: newKey,
    },
    legacyKey: current.legacyKey,
  };
}

function applyKeyConfigToProcess(config: KeyConfig) {
  process.env.XERO_TOKEN_ENCRYPTION_KEYS = JSON.stringify(config.keys);
  process.env.XERO_TOKEN_ENCRYPTION_KEY_ID = config.activeKeyId;
  if (config.legacyKey) {
    process.env.XERO_TOKEN_ENCRYPTION_KEY = config.legacyKey;
  } else {
    delete process.env.XERO_TOKEN_ENCRYPTION_KEY;
  }
  resetXeroTokenEncryptionKeyForTests();
}

function generateKeyId() {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "_");
  return `xero_${today}_${randomBytes(3).toString("hex")}`;
}

function generateKey() {
  return randomBytes(32).toString("base64");
}

export function redactSecret(value: string | null | undefined) {
  if (!value) return "(unset)";
  if (value.length <= 8) return "[redacted]";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function redactDatabaseUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.protocol}//[redacted]@${url.host}${url.pathname}`;
  } catch {
    return "[invalid database url]";
  }
}

function databaseHostAndName(value: string) {
  try {
    const url = new URL(value);
    return `${url.hostname}/${url.pathname.replace(/^\//, "") || "(default)"}`;
  } catch {
    return "[invalid database url]";
  }
}

async function promptExact(message: string, expected: string) {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`${message}\nType '${expected}' to continue: `);
    if (answer !== expected) {
      throw new Error("Confirmation did not match; aborting.");
    }
  } finally {
    rl.close();
  }
}

async function loadRows(pool: Pool): Promise<{
  totalConnections: number;
  rows: XeroTokenRow[];
}> {
  const total = await pool.query<{ count: string }>(
    "select count(*)::text as count from integrations.connections"
  );
  const rows = await pool.query<XeroTokenRow>(
    `select id,
            organization_id,
            provider,
            token_encryption_key_id,
            access_token_ciphertext,
            refresh_token_ciphertext
       from integrations.connections
      order by id`,
  );

  return {
    totalConnections: Number(total.rows[0]?.count ?? "0"),
    rows: rows.rows,
  };
}

function decryptRow(row: XeroTokenRow) {
  return {
    accessToken: decryptXeroToken(
      row.access_token_ciphertext,
      row.token_encryption_key_id
    ),
    refreshToken: decryptXeroToken(
      row.refresh_token_ciphertext,
      row.token_encryption_key_id
    ),
  };
}

async function rotateRows(pool: Pool, rows: XeroTokenRow[], activeKeyId: string) {
  const summary: RotationSummary = {
    totalConnections: 0,
    rowsScanned: rows.length,
    rowsRotated: 0,
    rowsAlreadyActive: 0,
    rowsSkipped: 0,
    decryptFailures: 0,
    verifyFailures: 0,
  };

  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const batch = rows.slice(index, index + BATCH_SIZE);

    for (const candidate of batch) {
      if (candidate.token_encryption_key_id === activeKeyId) {
        summary.rowsAlreadyActive += 1;
        continue;
      }

      const client = await pool.connect();
      try {
        await client.query("begin");
        const locked = await client.query<XeroTokenRow>(
          `select id,
                  organization_id,
                  provider,
                  token_encryption_key_id,
                  access_token_ciphertext,
                  refresh_token_ciphertext
             from integrations.connections
            where id = $1
            for update`,
          [candidate.id]
        );
        const row = locked.rows[0];
        if (!row) {
          summary.rowsSkipped += 1;
          await client.query("rollback");
          continue;
        }

        if (row.token_encryption_key_id === activeKeyId) {
          summary.rowsAlreadyActive += 1;
          await client.query("commit");
          continue;
        }

        let tokens: ReturnType<typeof decryptRow>;
        try {
          tokens = decryptRow(row);
        } catch {
          summary.decryptFailures += 1;
          await client.query("rollback");
          continue;
        }

        const accessToken = encryptXeroToken(tokens.accessToken);
        const refreshToken = encryptXeroToken(tokens.refreshToken);
        if (
          accessToken.keyId !== activeKeyId ||
          refreshToken.keyId !== activeKeyId
        ) {
          throw new Error("Encrypted token key id did not match active key id.");
        }

        await client.query(
          `update integrations.connections
              set access_token_ciphertext = $1,
                  refresh_token_ciphertext = $2,
                  token_encryption_key_id = $3,
                  updated_at = now()
            where id = $4`,
          [
            accessToken.ciphertext,
            refreshToken.ciphertext,
            activeKeyId,
            row.id,
          ]
        );
        await client.query("commit");
        summary.rowsRotated += 1;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
  }

  return summary;
}

async function verifyRows(pool: Pool, activeKeyId: string) {
  const { totalConnections, rows } = await loadRows(pool);
  const summary: RotationSummary = {
    totalConnections,
    rowsScanned: rows.length,
    rowsRotated: 0,
    rowsAlreadyActive: 0,
    rowsSkipped: Math.max(totalConnections - rows.length, 0),
    decryptFailures: 0,
    verifyFailures: 0,
  };

  for (const row of rows) {
    try {
      decryptRow(row);
    } catch {
      summary.decryptFailures += 1;
    }

    if (row.token_encryption_key_id === activeKeyId) {
      summary.rowsAlreadyActive += 1;
    } else {
      summary.verifyFailures += 1;
    }
  }

  return { summary, rows };
}

function printSummary(
  title: string,
  summary: RotationSummary,
  oldKeyId: string,
  newKeyId: string,
  retired: boolean
) {
  console.log(`\n${title}`);
  console.log(`Old key id: ${oldKeyId}`);
  console.log(`New key id: ${newKeyId}`);
  console.log(`Rows scanned: ${summary.rowsScanned}`);
  console.log(`Rows rotated: ${summary.rowsRotated}`);
  console.log(`Rows already active: ${summary.rowsAlreadyActive}`);
  console.log(`Rows skipped: ${summary.rowsSkipped}`);
  console.log(`Decrypt failures: ${summary.decryptFailures}`);
  console.log(`Verify failures: ${summary.verifyFailures}`);
  console.log(`Old key retired: ${retired ? "yes" : "no"}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  requireProductionTarget(args);

  const project = readVercelProject();
  const env = args.envFile
    ? readEnvFile(args.envFile)
    : loadVercelEnv(args.environment!);
  const currentConfig = parseKeyConfig(env);
  const oldKeyId = currentConfig.activeKeyId;
  const newKeyId = args.newKeyId ?? generateKeyId();
  const newKey = args.newKey ?? generateKey();
  const nextConfig = createNextKeyConfig(currentConfig, newKeyId, newKey);
  const databaseUrl = env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required; use the owner/admin database URL.");
  }

  applyKeyConfigToProcess(nextConfig);

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const initial = await loadRows(pool);
    const initialFailures = initial.rows.filter((row) => {
      try {
        decryptRow(row);
        return false;
      } catch {
        return true;
      }
    }).length;

    console.log("Resolved rotation target");
    console.log(`Vercel org: ${project.orgId}`);
    console.log(`Vercel project: ${project.projectId}`);
    console.log(`Environment: ${args.environment}`);
    console.log(`Database: ${databaseHostAndName(databaseUrl)}`);
    console.log(`Database URL: ${redactDatabaseUrl(databaseUrl)}`);
    console.log(`Old active key id: ${oldKeyId}`);
    console.log(`New key id: ${newKeyId}`);
    console.log(`New key: ${redactSecret(newKey)}`);
    console.log(`Accounting connection rows affected: ${initial.rows.length}`);
    console.log(`Initial decrypt failures: ${initialFailures}`);

    if (!args.apply) {
      const verify = await verifyRows(pool, oldKeyId);
      printSummary(
        "Dry-run complete",
        {
          ...verify.summary,
          rowsAlreadyActive: initial.rows.filter(
            (row) => row.token_encryption_key_id === newKeyId
          ).length,
        },
        oldKeyId,
        newKeyId,
        false
      );
      console.log("\nNo writes performed. Re-run with --apply to rotate.");
      return;
    }

    if (initialFailures > 0) {
      throw new Error(
        "One or more existing accounting token rows could not be decrypted with the configured keys; no writes were performed."
      );
    }

    await promptExact(
      "Confirm the resolved production target and generated key before Vercel env writes.",
      `rotate ${newKeyId}`
    );

    setVercelEnv(
      "XERO_TOKEN_ENCRYPTION_KEYS",
      JSON.stringify(nextConfig.keys),
      args.environment!
    );
    setVercelEnv("XERO_TOKEN_ENCRYPTION_KEY_ID", newKeyId, args.environment!);

    console.log(
      "\nVercel env now includes old + new keys with the new key active."
    );
    console.log("Redeploy/restart production before continuing.");
    await promptExact(
      "Confirm production has been redeployed with both keys available.",
      `redeployed ${newKeyId}`
    );

    const rotated = await rotateRows(pool, initial.rows, newKeyId);
    const verify = await verifyRows(pool, newKeyId);
    const combinedSummary: RotationSummary = {
      ...verify.summary,
      rowsRotated: rotated.rowsRotated,
      decryptFailures: rotated.decryptFailures + verify.summary.decryptFailures,
    };

    if (
      combinedSummary.decryptFailures > 0 ||
      combinedSummary.verifyFailures > 0
    ) {
      printSummary(
        "Rotation finished with verification failures",
        combinedSummary,
        oldKeyId,
        newKeyId,
        false
      );
      throw new Error("Verification failed; old key was not retired.");
    }

    printSummary(
      "Xero token key rotation complete",
      combinedSummary,
      oldKeyId,
      newKeyId,
      false
    );

    await promptExact(
      "Verification passed. Confirm old-key retirement from Vercel env.",
      `retire ${oldKeyId}`
    );

    const retiredConfig: KeyConfig = {
      ...nextConfig,
      keys: Object.fromEntries(
        Object.entries(nextConfig.keys).filter(([keyId]) => keyId !== oldKeyId)
      ),
    };
    if (retiredConfig.keys[oldKeyId]) {
      throw new Error("Old key was not removed from retired config.");
    }

    setVercelEnv(
      "XERO_TOKEN_ENCRYPTION_KEYS",
      JSON.stringify(retiredConfig.keys),
      args.environment!
    );
    removeVercelEnv("XERO_TOKEN_ENCRYPTION_KEY", args.environment!);

    printSummary(
      "Xero token key rotation complete",
      combinedSummary,
      oldKeyId,
      newKeyId,
      true
    );
    console.log("\nRedeploy/restart production again so the old key is removed from runtime.");
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
