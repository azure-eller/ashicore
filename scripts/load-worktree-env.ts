import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { config } from "dotenv";

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

  if (repoEnvPath && repoEnvPath !== localEnvPath && existsSync(repoEnvPath)) {
    config({ path: repoEnvPath });
  }

  if (existsSync(localEnvPath)) {
    config({
      path: localEnvPath,
      override: repoEnvPath != null && repoEnvPath !== localEnvPath,
    });
  }
}
