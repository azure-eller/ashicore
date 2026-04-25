import { defineConfig } from "drizzle-kit";
import { loadWorktreeEnv } from "./scripts/load-worktree-env";

loadWorktreeEnv();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required. In a worktree, run `pnpm db:local:setup` first."
  );
}

export default defineConfig({
  out: "./drizzle",
  schema: "./lib/db/schema/migrations.ts",
  dialect: "postgresql",
  schemaFilter: ["inventory", "sales", "purchasing", "manufacturing", "system", "xero", "agent"],
  dbCredentials: {
    url: databaseUrl,
  },
});
