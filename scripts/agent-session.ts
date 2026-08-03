import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { getGitTopLevel } from "./local-db";

export interface AgentSession {
  port: number;
  baseUrl: string;
  dbName: string;
  branch: string;
  commit: string;
  worktreePath: string;
  testOrgId: string;
  reviewOrgSlug: string;
  devServerPid: number;
  devServerStartTime: string;
  updatedAt: string;
}

export const REVIEW_ORG_SLUG = "test-paonia-soil-co";

export const AGENT_SESSION_PATH = path.resolve(
  getGitTopLevel(),
  ".tmp",
  "agent-session.json"
);

export function readAgentSession(): AgentSession | null {
  try {
    return JSON.parse(fs.readFileSync(AGENT_SESSION_PATH, "utf8")) as AgentSession;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function writeAgentSession(session: AgentSession): void {
  fs.mkdirSync(path.dirname(AGENT_SESSION_PATH), { recursive: true });
  fs.writeFileSync(AGENT_SESSION_PATH, JSON.stringify(session, null, 2));
}

export function touchAgentSession(
  expected?: Pick<AgentSession, "devServerPid" | "devServerStartTime">
): AgentSession | null {
  const session = readAgentSession();
  if (!session) return null;
  if (
    expected &&
    (session.devServerPid !== expected.devServerPid ||
      session.devServerStartTime !== expected.devServerStartTime)
  ) {
    return session;
  }
  const refreshed = { ...session, updatedAt: new Date().toISOString() };
  writeAgentSession(refreshed);
  return refreshed;
}

export function startAgentSessionLease(): () => void {
  const session = readAgentSession();
  if (!session) return () => {};
  const expected = {
    devServerPid: session.devServerPid,
    devServerStartTime: session.devServerStartTime,
  };
  touchAgentSession(expected);
  const leaseDir = path.resolve(path.dirname(AGENT_SESSION_PATH), "agent-session-leases");
  const leasePath = path.join(leaseDir, `${process.pid}.json`);
  const startTime = processStartTime(process.pid);
  if (!startTime) return () => {};
  fs.mkdirSync(leaseDir, { recursive: true });
  fs.writeFileSync(leasePath, JSON.stringify({ pid: process.pid, startTime }));
  return () => fs.rmSync(leasePath, { force: true });
}

export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, () => {
      const address = server.address();
      if (typeof address !== "object" || !address) {
        server.close(() => reject(new Error("Unexpected socket address type")));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

export async function isServerHealthy(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/auth/ok`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function gitValue(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

export function currentBranch(): string {
  return gitValue(["branch", "--show-current"]);
}

export function currentCommit(): string {
  return gitValue(["rev-parse", "HEAD"]);
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function processStartTime(pid: number): string | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return fields[19] ?? null;
  } catch {
    return null;
  }
}

export function isAgentDevServerAlive(session: AgentSession): boolean {
  return (
    typeof session.devServerStartTime === "string" &&
    processStartTime(session.devServerPid) === session.devServerStartTime
  );
}
