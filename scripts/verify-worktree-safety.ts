import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

function git(
  args: string[],
  options: { allowFailure?: boolean; cwd?: string } = {}
) {
  const result = spawnSync("git", args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });

  if (!options.allowFailure && result.status !== 0) {
    const command = `git ${args.join(" ")}`;
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(`${command} failed${detail ? `:\n${detail}` : ""}`);
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function fail(messages: string[]) {
  console.error(
    [
      "Worktree safety check failed.",
      "",
      ...messages,
      "",
      "Expected workflow:",
      "  git worktree add .worktrees/<branch-name> -b <branch-name> origin/main",
      "  cd .worktrees/<branch-name>",
      "  git fetch origin main && git rebase origin/main",
      "",
      "Override only for explicit maintainer/root-maintenance work:",
      "  ERP_ALLOW_UNSAFE_WORKTREE=1 <command>",
    ].join("\n")
  );
  process.exit(1);
}

if (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true") {
  process.exit(0);
}

if (process.env.ERP_ALLOW_UNSAFE_WORKTREE === "1") {
  process.exit(0);
}

const branch = git(["branch", "--show-current"]).stdout;
const toplevel = resolve(git(["rev-parse", "--show-toplevel"]).stdout);
const commonGitDir = resolve(
  git(["rev-parse", "--path-format=absolute", "--git-common-dir"]).stdout
);
const rootCheckout = dirname(commonGitDir);
const failures: string[] = [];

if (!branch) {
  failures.push("This checkout is detached. Use a named feature branch in a dedicated worktree.");
} else if (branch === "main") {
  failures.push("This checkout is on main. Code-changing validation must run from a non-main worktree branch.");
}

const rootBranchResult = git(["branch", "--show-current"], {
  allowFailure: true,
  cwd: rootCheckout,
});

if (rootBranchResult.status !== 0) {
  failures.push(
    `Could not inspect the repo root checkout (${rootCheckout}).`,
    rootBranchResult.stderr || rootBranchResult.stdout || "git branch exited without details."
  );
} else if (rootBranchResult.stdout !== "main") {
  failures.push(
    `The repo root checkout (${rootCheckout}) is on ${rootBranchResult.stdout || "<detached>"} instead of main.`,
    "Do not use the root checkout for PR review or feature work."
  );
}

if (toplevel === rootCheckout && branch === "main") {
  failures.push("Run code-changing validation from a dedicated non-root worktree.");
}

const fetchResult = git(
  ["fetch", "origin", "main:refs/remotes/origin/main"],
  { allowFailure: true }
);

if (fetchResult.status !== 0) {
  failures.push(
    "Could not fetch current origin/main.",
    fetchResult.stderr || fetchResult.stdout || "git fetch exited without details."
  );
} else if (branch && branch !== "main") {
  const baseCheck = git(
    ["merge-base", "--is-ancestor", "origin/main", "HEAD"],
    { allowFailure: true }
  );

  if (baseCheck.status !== 0) {
    failures.push(
      `Branch ${branch} does not contain current origin/main.`,
      "Run: git fetch origin main && git rebase origin/main"
    );
  }
}

if (failures.length > 0) {
  fail(failures);
}
