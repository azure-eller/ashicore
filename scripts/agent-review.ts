import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadWorktreeEnv } from "./load-worktree-env";
import { getGitTopLevel } from "./local-db";
import {
  currentBranch,
  currentCommit,
  readAgentSession,
} from "./agent-session";
import { seedReviewOrg } from "./seed-review-org";

loadWorktreeEnv();

const root = getGitTopLevel();

type ValidationResult = { name: string; command: string; status: "pass" | "fail" | "skip" };

function csv(value: string | boolean | undefined): string[] {
  return typeof value === "string"
    ? value.split(",").map((v) => v.trim()).filter(Boolean)
    : [];
}

// Expand a --domain shorthand into slow + validate defaults.
function resolveScopes(values: Record<string, string | boolean | string[] | undefined>) {
  const domain = typeof values.domain === "string" ? values.domain : undefined;
  const slow = csv(values.slow as string | boolean | undefined);
  const slowDomains = slow.length ? slow : domain ? [domain] : [];

  const validateRaw = csv(values.validate as string | boolean | undefined);
  const validate = validateRaw.length
    ? validateRaw
    : ["build", "lint", ...(domain ? [`fast:${domain}`] : ["fast"])];

  const inventory = values.inventory === true;
  return { slowDomains, validate, inventory };
}

function commandFor(token: string): string[] | null {
  if (token === "build") return ["pnpm", "build"];
  if (token === "lint") return ["pnpm", "lint"];
  if (token === "fast") return ["pnpm", "test:fast"];
  if (token.startsWith("fast:")) return ["pnpm", `test:fast:${token.slice(5)}`];
  if (token.startsWith("slow:")) return ["pnpm", `test:slow:${token.slice(5)}`];
  return null;
}

function run(command: string[]): boolean {
  try {
    execFileSync(command[0], command.slice(1), { cwd: root, stdio: "inherit" });
    return true;
  } catch {
    return false;
  }
}

function validationBlock(results: ValidationResult[], reviewUrl: string): string {
  const lines = results.map((r) => {
    const label =
      r.status === "skip" ? "not applicable" : r.status === "pass" ? "pass" : "FAIL";
    return `- ${r.command}: ${label}`;
  });
  return [
    "Local validation:",
    ...lines,
    "",
    "Review:",
    `- URL: ${reviewUrl}`,
    "- Seed: current Paonia snapshot",
    "- Org: test-paonia-soil-co",
  ].join("\n");
}

function prExists(branch: string): boolean {
  try {
    execFileSync("gh", ["pr", "view", branch, "--json", "number"], {
      cwd: root,
      stdio: ["ignore", "ignore", "pipe"],
    });
    return true;
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? "";
    if (/no pull requests found/i.test(stderr)) return false;
    // Auth/network/other error — do not silently assume "no PR" (would risk a duplicate).
    throw error;
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      slow: { type: "string" },
      validate: { type: "string" },
      domain: { type: "string" },
      inventory: { type: "boolean" },
      cached: { type: "boolean" },
      "docs-only": { type: "boolean" },
    },
  });
  const reviewPath = positionals[0] ?? "/";
  const cached = values.cached === true;
  const { slowDomains, validate, inventory } = resolveScopes(values);

  let session = readAgentSession();
  if (!session) {
    throw new Error("No .tmp/agent-session.json. Run 'pnpm boot' first.");
  }

  // Missing slow label is fatal — honors the explicit-label decision.
  const docsOnly = values["docs-only"] === true;
  if (slowDomains.length === 0 && !docsOnly) {
    throw new Error(
      "Refusing to review without an explicit slow label. Pass --slow <domains> (or --docs-only for docs/CI-only changes). Path inference never decides labels."
    );
  }

  const unknownTokens = validate.filter((token) => commandFor(token) === null);
  if (unknownTokens.length > 0) {
    throw new Error(
      `Unknown --validate token(s): ${unknownTokens.join(", ")}. Valid tokens: build, lint, fast, fast:<domain>, slow:<domain>.`
    );
  }

  // Stale dev server: silently refresh via up's idempotent restart so you always
  // eyeball current code, then re-read the refreshed session.
  if (session.commit !== currentCommit() || session.branch !== currentBranch()) {
    console.log(
      `Dev server was stale (${session.branch}@${session.commit.slice(0, 7)} → ${currentBranch()}@${currentCommit().slice(0, 7)}); refreshing via 'pnpm boot'...`
    );
    execFileSync("pnpm", ["boot"], { cwd: root, stdio: "inherit" });
    session = readAgentSession();
    if (!session) throw new Error("Lost agent session after refresh.");
  }

  // Phase 1: prepare review data (independent of validation outcome).
  await seedReviewOrg({ baseUrl: session.baseUrl, cached, log: console.log });

  // Phase 2: validate.
  const results: ValidationResult[] = [];
  for (const token of validate) {
    const command = commandFor(token);
    if (!command) {
      console.warn(`Unknown validation token '${token}', skipping.`);
      continue;
    }
    console.log(`\n▶ ${command.join(" ")}`);
    results.push({
      name: token,
      command: command.join(" "),
      status: run(command) ? "pass" : "fail",
    });
  }
  for (const domain of slowDomains) {
    const command = ["pnpm", `test:slow:${domain}`];
    console.log(`\n▶ ${command.join(" ")}`);
    results.push({
      name: `slow:${domain}`,
      command: command.join(" "),
      status: run(command) ? "pass" : "fail",
    });
  }
  results.push(
    inventory
      ? {
          name: "inventory",
          command: "pnpm verify:inventory",
          status: run(["pnpm", "verify:inventory"]) ? "pass" : "fail",
        }
      : { name: "inventory", command: "pnpm verify:inventory", status: "skip" }
  );

  const reviewUrl = new URL(reviewPath, session.baseUrl).toString();

  // Phase 3: open browser (failures here must not lose validation results).
  try {
    const out = fs.openSync(
      path.resolve(root, ".tmp", "review-browser.log"),
      "a"
    );
    const child = spawn("tsx", ["scripts/review-browser.ts", reviewPath], {
      cwd: root,
      detached: true,
      stdio: ["ignore", out, out],
      env: { ...process.env, REVIEW_BASE_URL: session.baseUrl },
    });
    child.unref();
    console.log(`\nReview browser opening at ${reviewUrl}`);
  } catch (error) {
    console.warn(`Could not open review browser: ${(error as Error).message}`);
  }

  const allGreen = results.every((r) => r.status !== "fail");
  const body = validationBlock(results, reviewUrl);
  console.log(`\n${body}\n`);

  if (!allGreen) {
    console.error(
      "Validation failed — review data + browser are ready to inspect, but the PR was NOT opened. Fix and re-run 'pnpm review'."
    );
    process.exit(1);
  }

  // Clean tree required before the PR phase — push only carries commits, so a dirty
  // tree means validation just ran on code that would never reach the PR.
  const dirty = execFileSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (dirty) {
    console.error(
      `Working tree is dirty — review data + browser are ready, but the PR was NOT opened. Commit and re-run 'pnpm review'.\n${dirty}`
    );
    process.exit(1);
  }

  // Phase 4: open/update PR (ready).
  const branch = currentBranch();
  execFileSync("git", ["push", "-u", "origin", branch], {
    cwd: root,
    stdio: "inherit",
  });

  if (prExists(branch)) {
    execFileSync("gh", ["pr", "edit", branch, "--body", body], {
      cwd: root,
      stdio: "inherit",
    });
    execFileSync("gh", ["pr", "ready", branch], { cwd: root, stdio: "inherit" });
  } else {
    execFileSync(
      "gh",
      ["pr", "create", "--fill", "--head", branch, "--body", body],
      { cwd: root, stdio: "inherit" }
    );
  }

  // Phase 5: labels — slow first, ci:ready last.
  const labels =
    slowDomains.length > 0
      ? slowDomains.map((d) => `ci:slow:${d}`)
      : ["ci:slow:none"];
  try {
    for (const label of labels) {
      execFileSync("gh", ["pr", "edit", branch, "--add-label", label], {
        cwd: root,
        stdio: "inherit",
      });
    }
    execFileSync("gh", ["pr", "edit", branch, "--add-label", "ci:ready"], {
      cwd: root,
      stdio: "inherit",
    });
    console.log(`\nPR ready with labels: ${[...labels, "ci:ready"].join(", ")}`);
  } catch (error) {
    console.error(
      `PR is open, but applying labels failed: ${(error as Error).message}\nRe-run 'pnpm review ...' to finish labeling (it will reuse the existing PR).`
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
