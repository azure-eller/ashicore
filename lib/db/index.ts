import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzleNode } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

// App role (RLS enforced, no DDL). Falls back to DATABASE_URL for migration scripts.
const connectionString =
  process.env.DATABASE_URL_APP || process.env.DATABASE_URL!;

// Use the Neon serverless driver on Vercel/production (WebSocket protocol).
// Fall back to standard pg for local dev and CI where Postgres is plain TCP.
const isNeon = connectionString.includes(".neon.tech");

function createDb() {
  if (isNeon) {
    const { Pool } = require("@neondatabase/serverless") as typeof import("@neondatabase/serverless");
    return drizzleNeon({ client: new Pool({ connectionString }), schema });
  }

  const { Pool } = require("pg") as typeof import("pg");
  return drizzleNode({ client: new Pool({ connectionString }), schema });
}

export const db = createDb();
