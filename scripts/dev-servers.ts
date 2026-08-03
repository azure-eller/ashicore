import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { processStartTime } from "./agent-session";

const IDLE_MS = Number(process.env.ERP_DEV_IDLE_MINUTES ?? "30") * 60_000;
const POLL_MS = 60_000;
const gitCommonDir = execFileSync(
  "git",
  ["rev-parse", "--path-format=absolute", "--git-common-dir"],
  { encoding: "utf8" }
).trim();
const reaperFile = path.join(gitCommonDir, "erp-dev-reaper.json");

type Session = {
  branch: string;
  baseUrl: string;
  devServerPid: number;
  devServerStartTime: string;
  updatedAt: string;
};

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function worktrees(): string[] {
  const output = execFileSync("git", ["--git-dir", gitCommonDir, "worktree", "list", "--porcelain"], {
    encoding: "utf8",
  });
  return output
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

function isSessionServerAlive(session: Session): boolean {
  return (
    typeof session.devServerStartTime === "string" &&
    processStartTime(session.devServerPid) === session.devServerStartTime
  );
}

function hasActiveLease(worktree: string): boolean {
  const leaseDir = path.join(worktree, ".tmp", "agent-session-leases");
  let entries: string[];
  try {
    entries = fs.readdirSync(leaseDir);
  } catch {
    return false;
  }
  return entries.some((entry) => {
    const leaseFile = path.join(leaseDir, entry);
    try {
      const lease = JSON.parse(fs.readFileSync(leaseFile, "utf8")) as {
        pid: number;
        startTime: string;
      };
      if (processStartTime(lease.pid) === lease.startTime) return true;
    } catch {}
    fs.rmSync(leaseFile, { force: true });
    return false;
  });
}

function readSession(worktree: string): Session | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(worktree, ".tmp", "agent-session.json"), "utf8")
    ) as Session;
  } catch {
    return null;
  }
}

function stopGroup(pid: number) {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already stopped.
    }
  }
}

function reapIdle() {
  const now = Date.now();
  for (const worktree of worktrees()) {
    const session = readSession(worktree);
    if (!session || !isSessionServerAlive(session) || hasActiveLease(worktree)) continue;
    const idleMs = now - Date.parse(session.updatedAt);
    if (Number.isFinite(idleMs) && idleMs >= IDLE_MS) {
      const sessionFile = path.join(worktree, ".tmp", "agent-session.json");
      const current = readSession(worktree);
      if (
        !current ||
        current.devServerPid !== session.devServerPid ||
        current.devServerStartTime !== session.devServerStartTime ||
        current.updatedAt !== session.updatedAt ||
        !isSessionServerAlive(current) ||
        hasActiveLease(worktree)
      ) continue;
      stopGroup(session.devServerPid);
      const stopped = readSession(worktree);
      if (
        stopped?.devServerPid === session.devServerPid &&
        stopped.devServerStartTime === session.devServerStartTime &&
        stopped.updatedAt === session.updatedAt
      ) {
        fs.rmSync(sessionFile, { force: true });
      }
      console.log(
        `Stopped idle dev server for ${session.branch} after ${Math.floor(idleMs / 60_000)} minutes.`
      );
    }
  }
}

function processGroupRss(pid: number): number {
  try {
    const output = execFileSync("ps", ["-eo", "pgid=,rss="], { encoding: "utf8" });
    return output.split("\n").reduce((total, line) => {
      const [pgid, rss] = line.trim().split(/\s+/).map(Number);
      return pgid === pid ? total + (rss || 0) : total;
    }, 0);
  } catch {
    return 0;
  }
}

function printStatus() {
  const rows = worktrees()
    .map((worktree) => ({ worktree, session: readSession(worktree) }))
    .filter((row): row is { worktree: string; session: Session } => Boolean(row.session))
    .map(({ worktree, session }) => {
      const running = isSessionServerAlive(session);
      const idle = Math.max(0, Math.floor((Date.now() - Date.parse(session.updatedAt)) / 60_000));
      return {
        branch: session.branch,
        status: running ? "running" : "stopped",
        memory: running ? `${Math.round(processGroupRss(session.devServerPid) / 1024)} MB` : "-",
        idle: `${idle}m`,
        url: session.baseUrl,
        worktree: path.basename(worktree),
      };
    });

  if (rows.length === 0) {
    console.log("No worktree dev-server sessions found.");
    return;
  }
  console.table(rows);
  console.log(`Running servers stop after ${IDLE_MS / 60_000} minutes without workflow activity.`);
}

function reaperIsRunning(): boolean {
  try {
    const { pid } = JSON.parse(fs.readFileSync(reaperFile, "utf8")) as { pid: number };
    if (!isAlive(pid)) return false;
    return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("--watch");
  } catch {
    return false;
  }
}

async function ensureReaper() {
  if (reaperIsRunning()) return;
  const script = path.resolve(process.argv[1]);
  const tsxCli = path.resolve(path.dirname(script), "..", "node_modules", "tsx", "dist", "cli.mjs");
  const child = spawn(process.execPath, [tsxCli, script, "--watch"], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
  });
  if (!child.pid) throw new Error("Failed to start the dev-server idle reaper.");
  await new Promise((resolve) => setTimeout(resolve, 100));
  if (child.exitCode !== null || !isAlive(child.pid)) {
    throw new Error("The dev-server idle reaper exited during startup.");
  }
  child.unref();
  fs.writeFileSync(reaperFile, JSON.stringify({ pid: child.pid }));
}

async function watch() {
  fs.writeFileSync(reaperFile, JSON.stringify({ pid: process.pid }));
  for (;;) {
    reapIdle();
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

async function main() {
  const command = process.argv[2];
  if (command === "--watch") {
    await watch();
  } else if (command === "--ensure-reaper") {
    await ensureReaper();
  } else {
    reapIdle();
    printStatus();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
