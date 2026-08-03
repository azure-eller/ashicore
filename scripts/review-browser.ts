import fs from "node:fs";
import path from "node:path";
import { chromium, type Cookie } from "@playwright/test";
import { getGitTopLevel } from "./local-db";
import { isPidAlive, startAgentSessionLease } from "./agent-session";
import { REVIEW_STORAGE_STATE_PATH } from "../test/helpers/test-env";

const root = getGitTopLevel();
const PID_FILE = path.resolve(root, ".tmp", "review-browser.pid");
const PROFILE_DIR = path.resolve(root, ".tmp", "chrome-review-profile");

async function killPrevious() {
  let pid: number;
  try {
    pid = Number(fs.readFileSync(PID_FILE, "utf8").trim());
  } catch {
    return; // nothing recorded
  }
  if (!pid || !isPidAlive(pid)) return;

  // review-browser is spawned detached (a process-group leader), so signalling
  // the group (-pid) tears down the Chromium child too and releases the profile
  // lock. Fall back to the bare pid for a non-detached (manual) launch.
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    /* not a group leader */
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* already gone */
  }

  const start = Date.now();
  while (isPidAlive(pid) && Date.now() - start < 3000) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function main() {
  startAgentSessionLease();
  const targetPath = process.argv[2] ?? "/";
  const baseUrl = process.env.REVIEW_BASE_URL;
  if (!baseUrl) throw new Error("REVIEW_BASE_URL is required.");

  let state: { cookies: Cookie[] };
  try {
    state = JSON.parse(fs.readFileSync(REVIEW_STORAGE_STATE_PATH, "utf8")) as {
      cookies: Cookie[];
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `No review session at ${REVIEW_STORAGE_STATE_PATH}. Run 'pnpm review' (which seeds the review org) first.`
      );
    }
    throw error;
  }

  await killPrevious();
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: null,
    args: ["--start-maximized", "--window-size=1920,1080"],
  });

  // Record our pid immediately so a later run can tear this down even if the
  // navigation below throws.
  fs.writeFileSync(PID_FILE, String(process.pid));

  const closeAndExit = async () => {
    try {
      await context.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  context.on("close", () => process.exit(0));
  process.on("SIGINT", closeAndExit);
  process.on("SIGTERM", closeAndExit);

  await context.addCookies(state.cookies);
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(new URL(targetPath, baseUrl).toString());

  // Stay alive so the window stays open for the user. Exit when it closes.
  await new Promise(() => {});
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
