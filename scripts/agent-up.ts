import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadWorktreeEnv } from "./load-worktree-env";
import { deriveDatabaseName, getGitTopLevel } from "./local-db";
import {
  type AgentSession,
  REVIEW_ORG_SLUG,
  currentBranch,
  currentCommit,
  getFreePort,
  isPidAlive,
  isServerHealthy,
  readAgentSession,
  writeAgentSession,
} from "./agent-session";

const root = getGitTopLevel();
const HEALTH_TIMEOUT_MS = 90_000;
const LOG_PATH = path.resolve(root, ".tmp", "agent-dev-server.log");

function requestedDevPort(): number | null {
  const raw = process.env.AGENT_DEV_PORT;
  if (!raw) return null;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`AGENT_DEV_PORT must be a valid TCP port, got "${raw}".`);
  }
  return port;
}

async function waitForHealth(baseUrl: string, pid: number) {
  const start = Date.now();
  while (Date.now() - start < HEALTH_TIMEOUT_MS) {
    if (!isPidAlive(pid)) {
      throw new Error(
        `Dev server exited before becoming healthy. See ${LOG_PATH}`
      );
    }
    if (await isServerHealthy(baseUrl)) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `Dev server did not become healthy at ${baseUrl} within ${HEALTH_TIMEOUT_MS / 1000}s. See ${LOG_PATH}`
  );
}

function getLanIp(): string | null {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return null;
}

function startDevServer(port: number): number {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  const out = fs.openSync(LOG_PATH, "a");

  // Bind 0.0.0.0 so the same server is reachable from localhost, the emulator
  // (10.0.2.2), and a physical device (host LAN IP). Two Better Auth checks must
  // accept these: Host-header resolution (BETTER_AUTH_ALLOWED_HOSTS, host:port) and
  // the plugin Origin/CSRF check (BETTER_AUTH_TRUSTED_ORIGINS, scheme://host:port).
  const lanIp = getLanIp();
  const mobileHosts = [`10.0.2.2:${port}`, lanIp ? `${lanIp}:${port}` : null]
    .filter(Boolean)
    .join(",");
  const allowedHosts = [process.env.BETTER_AUTH_ALLOWED_HOSTS, mobileHosts]
    .filter(Boolean)
    .join(",");
  // Include localhost:<port> too, so trusting these origins never drops the local
  // web flow regardless of whether trustedOrigins augments or replaces the default.
  const mobileOrigins = [
    `http://localhost:${port}`,
    `http://10.0.2.2:${port}`,
    lanIp ? `http://${lanIp}:${port}` : null,
  ]
    .filter(Boolean)
    .join(",");
  const trustedOrigins = [process.env.BETTER_AUTH_TRUSTED_ORIGINS, mobileOrigins]
    .filter(Boolean)
    .join(",");

  const child = spawn(
    "pnpm",
    ["exec", "next", "dev", "--disable-source-maps", "-H", "0.0.0.0", "-p", String(port)],
    {
      cwd: root,
      detached: true,
      stdio: ["ignore", out, out],
      env: {
        ...process.env,
        NODE_OPTIONS: "--max-old-space-size=4096",
        BETTER_AUTH_ALLOWED_HOSTS: allowedHosts,
        BETTER_AUTH_TRUSTED_ORIGINS: trustedOrigins,
      },
    }
  );
  child.unref();
  fs.closeSync(out);
  if (!child.pid) throw new Error("Failed to spawn dev server.");
  return child.pid;
}

async function main() {
  // 1. Worktree safety.
  execFileSync("pnpm", ["preflight"], { cwd: root, stdio: "inherit" });

  // 2 + 3. Local DB + migrations (idempotent). Must run before loadWorktreeEnv
  // so .env.local exists when env is loaded.
  execFileSync("pnpm", ["exec", "tsx", "scripts/setup-local-db.ts"], {
    cwd: root,
    stdio: "inherit",
  });

  // Load worktree env now that .env.local is guaranteed to exist.
  loadWorktreeEnv();

  // Resume a healthy server for this worktree, or start a fresh one.
  const existing = readAgentSession();
  const branch = currentBranch();
  const commit = currentCommit();

  let port: number;
  let pid: number;
  let baseUrl: string;

  const reusable =
    existing &&
    existing.worktreePath === root &&
    isPidAlive(existing.devServerPid) &&
    (await isServerHealthy(existing.baseUrl));

  if (reusable && existing.commit === commit && existing.branch === branch) {
    ({ port, baseUrl } = existing);
    pid = existing.devServerPid;
    console.log(`Reusing healthy dev server on ${baseUrl} (pid ${pid}).`);
  } else {
    if (reusable) {
      console.log(
        `Dev server (pid ${existing!.devServerPid}) is on stale ${existing!.branch}@${existing!.commit.slice(0, 7)}; restarting for ${branch}@${commit.slice(0, 7)}.`
      );
      try {
        process.kill(-existing!.devServerPid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
    port = requestedDevPort() ?? (await getFreePort());
    baseUrl = `http://localhost:${port}`;
    pid = startDevServer(port);
    console.log(`Starting dev server on ${baseUrl} (pid ${pid})...`);
    await waitForHealth(baseUrl, pid);
  }

  // 4. Ensure the test-org session (renew). Default slug = test-org.
  process.env.TEST_BASE_URL = baseUrl;
  const { ensureTestAccount } = await import(
    "../test/helpers/test-account-setup"
  );
  const result = await ensureTestAccount({
    baseUrl,
    log: (message) => console.log(message),
  });

  // 5. Write shared state.
  const session: AgentSession = {
    port,
    baseUrl,
    dbName: deriveDatabaseName(root),
    branch,
    commit,
    worktreePath: root,
    testOrgId: result.organizationId,
    reviewOrgSlug: REVIEW_ORG_SLUG,
    devServerPid: pid,
    updatedAt: new Date().toISOString(),
  };
  writeAgentSession(session);

  console.log("");
  console.log(`Dev env ready at ${baseUrl}`);
  console.log(
    "Loop: write throwaway specs in test/e2e/scratch/, run 'pnpm test:scratch', then 'pnpm review <path> --slow <domains>'."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
