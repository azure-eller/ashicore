import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { config } from "dotenv";

const DATABASE_ENV_KEYS = ["DATABASE_URL", "DATABASE_URL_APP"] as const;

function getRepoEnvPath(cwd: string) {
  try {
    const commonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    if (!commonDir) {
      return null;
    }

    return join(dirname(resolve(cwd, commonDir)), ".env.local");
  } catch {
    return null;
  }
}

export function loadWorktreeEnv(cwd = process.cwd()) {
  const localEnvPath = resolve(cwd, ".env.local");
  const repoEnvPath = getRepoEnvPath(cwd);
  const isLinkedWorktree =
    repoEnvPath != null && repoEnvPath !== localEnvPath;
  const initialDatabaseEnv = Object.fromEntries(
    DATABASE_ENV_KEYS.map((key) => [key, process.env[key]])
  ) as Record<(typeof DATABASE_ENV_KEYS)[number], string | undefined>;

  if (repoEnvPath && repoEnvPath !== localEnvPath && existsSync(repoEnvPath)) {
    config({ path: repoEnvPath });
  }

  if (isLinkedWorktree) {
    for (const key of DATABASE_ENV_KEYS) {
      if (initialDatabaseEnv[key] == null) {
        delete process.env[key];
      }
    }

    if (
      !existsSync(localEnvPath) &&
      DATABASE_ENV_KEYS.every((key) => process.env[key] == null)
    ) {
      throw new Error(
        `Worktree .env.local not found at ${localEnvPath}. Run \`pnpm db:local:setup\` first.`
      );
    }
  }

  if (existsSync(localEnvPath)) {
    config({
      path: localEnvPath,
      override: isLinkedWorktree,
    });
  }
}
