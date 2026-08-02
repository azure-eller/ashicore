import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "./fixtures";

const repoRoot = process.cwd();

function run(
  sql: string,
  args: string[] = [],
  verificationSql?: string,
  envOverride?: string
) {
  const directory = mkdtempSync(join(tmpdir(), "erp-production-db-test-"));
  const sqlFile = join(directory, "query.sql");
  const verificationFile = join(directory, "verify.sql");
  const envFile = join(directory, ".env.local");
  writeFileSync(sqlFile, sql);
  if (verificationSql) writeFileSync(verificationFile, verificationSql);
  if (envOverride) writeFileSync(envFile, envOverride);

  try {
    return execFileSync(
      "pnpm",
      [
        "ops:production-db",
        "--",
        "--org-slug",
        "test-org",
        "--sql-file",
        sqlFile,
        "--env-file",
        envOverride ? envFile : join(repoRoot, ".env.local"),
        ...(verificationSql ? ["--verify-sql-file", verificationFile] : []),
        ...args,
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, ERP_OPS_ALLOW_LOCAL_DATABASE: "1" },
      }
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("production database helper defaults to read-only and verifies explicit writes", () => {
  const output = run(
    "SELECT current_user AS role, current_setting('app.current_org_id', true) AS org_id"
  );

  expect(output).toContain("Mode: READ ONLY");
  expect(output).toContain("Role: app_user");
  expect(output).toContain("Organization: test-org");

  expect(() =>
    run("UPDATE system.organization SET name = name WHERE slug = 'test-org'")
  ).toThrow(/read-only transaction/i);

  const writeOutput = run(
    "UPDATE system.organization SET name = name WHERE slug = 'test-org'",
    ["--write", "--skip-checkpoint"],
    "SELECT slug FROM system.organization WHERE slug = 'test-org'"
  );
  expect(writeOutput).toContain("Mode: WRITE");
  expect(writeOutput).toContain("Affected rows: 1");
  expect(writeOutput).toContain('Verification rows: [{"slug":"test-org"}]');
});

test("production database helper never echoes database credentials", () => {
  const envText = readFileSync(join(repoRoot, ".env.local"), "utf8");
  const password = new URL(
    envText.match(/^DATABASE_URL_APP=(.*)$/m)?.[1] ?? ""
  ).password;
  const output = run("SELECT 1 AS ok");

  expect(password).not.toBe("");
  expect(output).not.toContain(password);
  expect(output).not.toContain("DATABASE_URL_APP");
});

test("production database helper protects its transaction boundary", () => {
  expect(() => run("COMMIT; UPDATE system.organization SET name = 'escaped'"))
    .toThrow(/exactly one statement/i);
  expect(() => run("COMMIT")).toThrow(/cannot control transactions/i);
  expect(() =>
    run("SELECT 1", ["--write", "--skip-checkpoint"], "ROLLBACK; SELECT 1")
  ).toThrow(/exactly one statement/i);
});

test("production database helper enforces the requested role", () => {
  const envText = readFileSync(join(repoRoot, ".env.local"), "utf8");
  const ownerUrl = envText.match(/^DATABASE_URL=(.*)$/m)?.[1];
  expect(ownerUrl).toBeTruthy();

  expect(() =>
    run("SELECT 1", [], undefined, `DATABASE_URL_APP=${ownerUrl}\n`)
  ).toThrow(/Expected database role app_user/i);
});
