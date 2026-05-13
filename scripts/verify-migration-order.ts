import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type JournalEntry = {
  idx: number;
  when: number;
  tag: string;
};

type Journal = {
  entries: JournalEntry[];
};

const JOURNAL_PATH = "drizzle/meta/_journal.json";
const MIGRATIONS_DIR = "drizzle";

function readJournalFromDisk(): Journal {
  return JSON.parse(readFileSync(JOURNAL_PATH, "utf8")) as Journal;
}

function readBaseJournal(): Journal | null {
  try {
    const output = execFileSync("git", ["show", `origin/main:${JOURNAL_PATH}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(output) as Journal;
  } catch {
    return null;
  }
}

function fetchOriginMain() {
  execFileSync("git", ["fetch", "--no-tags", "origin", "main:refs/remotes/origin/main"], {
    stdio: "inherit",
  });
}

function verifyInternal(journal: Journal): string[] {
  const errors: string[] = [];
  const seenIdx = new Set<number>();
  const seenWhen = new Set<number>();
  const seenTag = new Set<string>();

  for (let i = 0; i < journal.entries.length; i++) {
    const entry = journal.entries[i];
    const previous = journal.entries[i - 1];

    if (previous) {
      if (entry.idx <= previous.idx) {
        errors.push(
          `Journal idx must strictly increase: ${entry.tag} has ${entry.idx} after ${previous.idx}.`
        );
      }

      if (entry.when <= previous.when) {
        errors.push(
          `Journal when must strictly increase: ${entry.tag} has ${entry.when} after ${previous.when}.`
        );
      }
    }

    if (seenIdx.has(entry.idx)) errors.push(`Duplicate journal idx: ${entry.idx}.`);
    if (seenWhen.has(entry.when)) errors.push(`Duplicate journal when: ${entry.when}.`);
    if (seenTag.has(entry.tag)) errors.push(`Duplicate journal tag: ${entry.tag}.`);

    seenIdx.add(entry.idx);
    seenWhen.add(entry.when);
    seenTag.add(entry.tag);

    const migrationPath = join(MIGRATIONS_DIR, `${entry.tag}.sql`);
    if (!existsSync(migrationPath)) {
      errors.push(`Journal tag ${entry.tag} has no matching ${migrationPath}.`);
    }
  }

  return errors;
}

function verifyAgainstBase(current: Journal, base: Journal): string[] {
  const errors: string[] = [];
  const baseTags = new Set(base.entries.map((entry) => entry.tag));
  const baseMaxIdx = Math.max(...base.entries.map((entry) => entry.idx));
  const baseMaxWhen = Math.max(...base.entries.map((entry) => entry.when));
  const added = current.entries.filter((entry) => !baseTags.has(entry.tag));

  for (const entry of added) {
    if (entry.idx <= baseMaxIdx) {
      errors.push(
        `New migration ${entry.tag} has idx ${entry.idx}, which is not greater than origin/main max idx ${baseMaxIdx}.`
      );
    }

    if (entry.when <= baseMaxWhen) {
      errors.push(
        `New migration ${entry.tag} has when ${entry.when}, which is not greater than origin/main max when ${baseMaxWhen}.`
      );
    }
  }

  return errors;
}

function main() {
  const isCi = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
  const current = readJournalFromDisk();
  const errors = verifyInternal(current);

  if (isCi) {
    fetchOriginMain();
  }

  const base = readBaseJournal();
  if (base) {
    errors.push(...verifyAgainstBase(current, base));
  } else if (!isCi) {
    console.warn(
      "Warning: could not read origin/main migration journal. Run `git fetch origin main` before relying on this local check."
    );
  } else {
    errors.push("Could not read origin/main migration journal after fetch.");
  }

  if (!isCi && base) {
    console.warn(
      "Warning: local origin/main freshness was not verified. Run `git fetch origin main` before creating migrations."
    );
  }

  if (errors.length > 0) {
    console.error("Migration order verification failed.");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log(`Migration order verification passed for ${current.entries.length} entries.`);
}

main();
