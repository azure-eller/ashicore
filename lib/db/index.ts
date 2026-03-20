// Node 22+ has native WebSocket — no ws package needed
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

// App role (RLS enforced, no DDL). Falls back to DATABASE_URL for migration scripts.
const connectionString =
  process.env.DATABASE_URL_APP || process.env.DATABASE_URL!;
const pool = new Pool({ connectionString });

export const db = drizzle({ client: pool, schema });
