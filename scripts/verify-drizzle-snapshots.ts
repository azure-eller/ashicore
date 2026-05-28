import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Journal = {
  entries: Array<{ idx: number; tag: string }>;
};

const META_DIR = join(process.cwd(), "drizzle", "meta");
const JOURNAL_PATH = join(META_DIR, "_journal.json");

function latestSnapshotIdx() {
  const indices = readdirSync(META_DIR)
    .map((name) => /^(\d+)_snapshot\.json$/.exec(name)?.[1])
    .filter((value): value is string => value != null)
    .map((value) => Number(value));

  if (indices.length === 0) {
    throw new Error("No Drizzle snapshots found in drizzle/meta.");
  }

  return Math.max(...indices);
}

function latestJournalIdx() {
  const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf8")) as Journal;

  if (journal.entries.length === 0) {
    throw new Error("Migration journal has no entries.");
  }

  return Math.max(...journal.entries.map((entry) => entry.idx));
}

const snapshotIdx = latestSnapshotIdx();
const journalIdx = latestJournalIdx();

if (snapshotIdx !== journalIdx) {
  console.error(
    `Drizzle snapshot index ${snapshotIdx} does not match journal index ${journalIdx}.`
  );
  console.error(
    "Regenerate the current snapshot lineage from a fresh migrated database before running db:generate."
  );
  console.error("This guard checks lineage freshness; db:generate is the schema churn proof.");
  process.exit(1);
}

console.log(`Drizzle snapshots are current at idx ${snapshotIdx}.`);
