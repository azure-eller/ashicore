import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadWorktreeEnv } from "./load-worktree-env";
import { getGitTopLevel } from "./local-db";
import { readAgentSession } from "./agent-session";

const root = getGitTopLevel();

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      fresh: { type: "boolean" },
      cached: { type: "boolean" },
    },
  });
  const reviewPath = positionals[0] ?? "/";
  const fresh = values.fresh === true;
  const cached = values.cached === true;

  // 1. Boot (idempotent): local DB + migrate + test-org session + a backgrounded
  //    dev server on a free port + .tmp/agent-session.json. Boot writes .env.local,
  //    so load the worktree env only afterwards (DATABASE_URL is needed below).
  execFileSync("pnpm", ["boot"], { cwd: root, stdio: "inherit" });
  loadWorktreeEnv();

  // Imported dynamically (not at module top): seed-review-org runs loadWorktreeEnv
  // on import, which requires the .env.local that boot just created.
  const { ensureReviewSession, isReviewOrgSeeded, seedReviewOrg } = await import(
    "./seed-review-org"
  );

  const session = readAgentSession();
  if (!session) {
    throw new Error("No .tmp/agent-session.json after boot — cannot start the sandbox.");
  }

  // 2. Load the live Paonia production copy into the review org
  //    (test-paonia-soil-co) — unless it is already seeded and --fresh wasn't
  //    passed, in which case preserve whatever state the triage session built up.
  const alreadySeeded = await isReviewOrgSeeded();
  if (fresh || !alreadySeeded) {
    if (fresh && alreadySeeded) {
      console.log(
        "--fresh: re-importing the live Paonia snapshot (discards the current sandbox data)."
      );
    }
    await seedReviewOrg({ baseUrl: session.baseUrl, cached, log: console.log });
  } else {
    // Refresh only the review session/cookie so the browser authenticates; the
    // snapshot data is left exactly as it is.
    await ensureReviewSession({ baseUrl: session.baseUrl, log: console.log });
    console.log(
      "Reusing the existing sandbox data (review org already seeded). Pass --fresh to re-import current production."
    );
  }

  // 3. Open the authenticated review browser at the requested path.
  const reviewUrl = new URL(reviewPath, session.baseUrl).toString();
  try {
    const out = fs.openSync(path.resolve(root, ".tmp", "review-browser.log"), "a");
    const child = spawn("tsx", ["scripts/review-browser.ts", reviewPath], {
      cwd: root,
      detached: true,
      stdio: ["ignore", out, out],
      env: { ...process.env, REVIEW_BASE_URL: session.baseUrl },
    });
    child.unref();
    fs.closeSync(out);
  } catch (error) {
    console.warn(`Could not open review browser: ${(error as Error).message}`);
  }

  console.log("");
  console.log(
    `Sandbox ready at ${reviewUrl} — org test-paonia-soil-co, live production copy.`
  );
  console.log(
    "Browse, point the agent at fixes, watch them hot-reload. When ready, commit and run 'pnpm review <path> --slow <domains>' to land them."
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
