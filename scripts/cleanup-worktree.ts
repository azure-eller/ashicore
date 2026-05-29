import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import {
  DEFAULT_ADMIN_URL,
  deriveDatabaseName,
  ensureLocalPostgresAvailable,
  getCommonRepoRoot,
  isDockerPostgresRunning,
  quoteIdentifier,
  resolveComposeDir,
  runDockerCompose,
} from "./local-db";

type WorktreeInfo = {
  branch: string | null;
  path: string;
};

function listWorktrees(cwd = process.cwd()) {
  const output = execFileSync("git", ["worktree", "list", "--porcelain"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });

  const blocks = output
    .trim()
    .split("\n\n")
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.map<WorktreeInfo>((block) => {
    const lines = block.split("\n");
    const pathLine = lines.find((line) => line.startsWith("worktree "));
    const branchLine = lines.find((line) => line.startsWith("branch "));

    return {
      path: pathLine?.slice("worktree ".length) ?? "",
      branch: branchLine?.replace("branch refs/heads/", "") ?? null,
    };
  });
}

function getDirtyStatus(worktreePath: string) {
  return execFileSync("git", ["status", "--short"], {
    cwd: worktreePath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

async function dropDatabase(adminUrl: string, databaseName: string) {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();

  try {
    await client.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [databaseName]
    );
    await client.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
  } finally {
    await client.end();
  }
}

async function main() {
  const branchName = process.argv[2];

  if (!branchName) {
    console.error("Usage: pnpm worktree:cleanup <branch>");
    process.exit(1);
  }

  const force = process.argv.includes("--force");
  if (!force) {
    let prState = "";
    try {
      prState = execFileSync(
        "gh",
        ["pr", "view", branchName, "--json", "state", "--jq", ".state"],
        { encoding: "utf8" }
      ).trim();
    } catch {
      prState = "UNKNOWN";
    }
    if (prState !== "MERGED") {
      console.error(
        `Refusing to clean up '${branchName}': its PR is ${prState || "not found"}, not MERGED.\n` +
          `Keep the worktree/DB/dev server until the PR merges. Re-run with --force only if you are certain.`
      );
      process.exit(1);
    }
  }

  const repoRoot = getCommonRepoRoot();
  const currentCwd = resolve(process.cwd());
  const worktrees = listWorktrees(repoRoot);
  const targetWorktree = worktrees.find((worktree) => worktree.branch === branchName);

  if (!targetWorktree) {
    console.error(`No worktree found for branch '${branchName}'.`);
    process.exit(1);
  }

  const targetPath = resolve(targetWorktree.path);

  if (targetPath === repoRoot) {
    console.error("Refusing to clean up the repo root checkout.");
    process.exit(1);
  }

  if (currentCwd === targetPath || currentCwd.startsWith(`${targetPath}/`)) {
    console.error(
      `You are inside ${targetPath}. Run pnpm worktree:cleanup ${branchName} from the repo root or another worktree.`
    );
    process.exit(1);
  }

  if (!existsSync(targetPath)) {
    console.error(`Worktree path does not exist: ${targetPath}`);
    process.exit(1);
  }

  const dirtyStatus = getDirtyStatus(targetPath);
  if (dirtyStatus) {
    console.error(
      `Refusing to remove dirty worktree ${branchName}. Clean or commit these changes first:\n${dirtyStatus}`
    );
    process.exit(1);
  }

  // Stop the boot dev server before tearing down — it is kept alive until merge,
  // so otherwise this detached Next process would keep running from a removed cwd
  // against a dropped database.
  const sessionFile = resolve(targetPath, ".tmp", "agent-session.json");
  if (existsSync(sessionFile)) {
    try {
      const pid = JSON.parse(readFileSync(sessionFile, "utf8")).devServerPid;
      if (typeof pid === "number") {
        try {
          process.kill(-pid, "SIGTERM"); // process group (boot spawns detached)
        } catch {
          /* not a group leader */
        }
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          /* already gone */
        }
        console.log(`Stopped dev server (pid ${pid}) for ${branchName}.`);
      }
    } catch {
      /* unreadable session file — nothing to stop */
    }
  }

  const adminUrl = process.env.LOCAL_DB_ADMIN_URL ?? DEFAULT_ADMIN_URL;
  const databaseName = deriveDatabaseName(targetPath);
  const composeDir = resolveComposeDir(process.cwd(), targetPath, repoRoot);

  await ensureLocalPostgresAvailable(adminUrl, composeDir);
  await dropDatabase(adminUrl, databaseName);

  execFileSync("git", ["worktree", "remove", targetPath], {
    cwd: repoRoot,
    stdio: "inherit",
  });

  try {
    execFileSync("git", ["branch", "-d", branchName], {
      cwd: repoRoot,
      stdio: "inherit",
    });
  } catch {
    console.warn(
      `Dropped DB and removed worktree, but local branch '${branchName}' was not deleted.`
    );
  }

  const remainingWorktrees = listWorktrees(repoRoot).filter(
    (worktree) => resolve(worktree.path) !== repoRoot
  );

  if (remainingWorktrees.length === 0 && isDockerPostgresRunning(composeDir)) {
    console.log("No linked worktrees remain. Stopping the shared local Postgres container...");
    runDockerCompose(["stop", "postgres"], composeDir);
  }

  console.log(`Cleaned up ${branchName}.`);
  console.log(`Dropped local DB: ${databaseName}`);
  console.log(`Removed worktree: ${targetPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
