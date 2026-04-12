import type { NeonDatabase } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

// App role (RLS enforced, no DDL). Falls back to DATABASE_URL for migration scripts.
const connectionString =
  process.env.DATABASE_URL_APP || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL_APP or DATABASE_URL is required. In a worktree, run `pnpm db:local:setup` first."
  );
}

// Neon serverless driver uses WebSocket — only works against Neon Postgres.
// Plain Postgres (CI, local) needs the standard pg driver over TCP.
const isNeon = connectionString.includes(".neon.tech");

function createDb(): NeonDatabase<typeof schema> {
  if (isNeon) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require("@neondatabase/serverless") as typeof import("@neondatabase/serverless");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { drizzle } = require("drizzle-orm/neon-serverless") as typeof import("drizzle-orm/neon-serverless");
    return drizzle({ client: new Pool({ connectionString }), schema });
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require("pg") as typeof import("pg");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require("drizzle-orm/node-postgres") as typeof import("drizzle-orm/node-postgres");
  return drizzle({ client: new Pool({ connectionString }), schema }) as unknown as NeonDatabase<typeof schema>;
}

export const db = createDb();
