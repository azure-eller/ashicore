import { defineConfig } from "drizzle-kit";
import { loadWorktreeEnv } from "./scripts/load-worktree-env";

loadWorktreeEnv();

export default defineConfig({
  out: "./drizzle",
  schema: "./lib/db/schema/index.ts",
  dialect: "postgresql",
  schemaFilter: ["inventory", "sales", "purchasing", "manufacturing", "system"],
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
