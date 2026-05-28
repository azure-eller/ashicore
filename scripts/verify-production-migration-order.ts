import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";

type JournalEntry = {
  idx: number;
  when: number;
  tag: string;
};

type Journal = {
  entries: JournalEntry[];
};

const JOURNAL_PATH = "drizzle/meta/_journal.json";

function readJournalFromDisk(): Journal {
  return JSON.parse(readFileSync(JOURNAL_PATH, "utf8")) as Journal;
}

function readBaseJournal(): Journal {
  const output = execFileSync("git", ["show", `origin/main:${JOURNAL_PATH}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return JSON.parse(output) as Journal;
}

function hashMigration(tag: string) {
  return createHash("sha256").update(readFileSync(`drizzle/${tag}.sql`)).digest("hex");
}

async function main() {
  const databaseUrl = process.env.PRODUCTION_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("PRODUCTION_DATABASE_URL is required.");
  }

  execFileSync("git", ["fetch", "--no-tags", "origin", "main:refs/remotes/origin/main"], {
    stdio: "inherit",
  });

  const current = readJournalFromDisk();
  const base = readBaseJournal();
  const baseTags = new Set(base.entries.map((entry) => entry.tag));
  const added = current.entries.filter((entry) => !baseTags.has(entry.tag));

  if (added.length === 0) {
    console.log("No new migrations to compare with production.");
    return;
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const maxResult = await client.query<{ max_created_at: string | null }>(
      `SELECT max(created_at)::text AS max_created_at FROM drizzle.__drizzle_migrations`
    );
    const productionMax = Number(maxResult.rows[0]?.max_created_at ?? 0);

    const errors: string[] = [];
    for (const entry of added) {
      if (entry.when > productionMax) continue;

      const hash = hashMigration(entry.tag);
      const recorded = await client.query(
        `
          SELECT 1
          FROM drizzle.__drizzle_migrations
          WHERE created_at = $1
            AND hash = $2
        `,
        [entry.when, hash]
      );

      if (recorded.rowCount !== 1) {
        errors.push(
          `New migration ${entry.tag} has when ${entry.when}, which is not greater than production max ${productionMax}, and its hash is not recorded in production. Drizzle will skip it.`
        );
      }
    }

    if (errors.length > 0) {
      console.error("Production migration order verification failed.");
      for (const error of errors) console.error(`- ${error}`);
      process.exit(1);
    }

    console.log(
      `Production migration order verification passed for ${added.length} new migration(s).`
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
