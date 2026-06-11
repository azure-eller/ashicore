import "server-only";

import { attachPoolErrorHandler } from "./index";
import { env } from "@/lib/env";

/**
 * Dedicated connection pool for the agent's read-only SQL surface, authenticated
 * AS erp_agent_ro (session_user). This is a hard security boundary, not a
 * convenience: because the login role is a member of nothing and has SELECT on
 * agent_query.* views only, role-escalation (`SET ROLE`, `set_config('role',…)`)
 * and base-table access are denied by Postgres itself, regardless of what SQL
 * the model writes. Never point this at DATABASE_URL/DATABASE_URL_APP.
 */
type PoolClient = {
  query: (text: string, values?: unknown[]) => Promise<{ rows?: unknown[] }>;
  release: () => void;
};

type AgentPool = {
  connect: () => Promise<PoolClient>;
};

let cachedPool: AgentPool | null = null;

function createAgentPool(): AgentPool {
  const connectionString = env.DATABASE_URL_AGENT;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL_AGENT is required for the agent query tool. In a worktree, run `pnpm db:local:setup`."
    );
  }

  const isNeon = connectionString.includes(".neon.tech");
  if (isNeon) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require("@neondatabase/serverless") as typeof import("@neondatabase/serverless");
    return attachPoolErrorHandler(new Pool({ connectionString, max: 4 })) as unknown as AgentPool;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require("pg") as typeof import("pg");
  return attachPoolErrorHandler(new Pool({ connectionString, max: 4 })) as unknown as AgentPool;
}

function getAgentPool(): AgentPool {
  if (!cachedPool) {
    cachedPool = createAgentPool();
  }
  return cachedPool;
}

/**
 * Run one statement on the agent connection with the org pinned for the
 * transaction. The pin is immutable to the statement (set-once, temp-table
 * backed), so a forged GUC inside the SQL cannot widen the org scope.
 */
export async function runOnAgentConnection<T>(
  orgId: string,
  statementTimeoutMs: number,
  run: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getAgentPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('statement_timeout', $1, true)", [
      String(statementTimeoutMs),
    ]);
    await client.query("SELECT agent_query.pin_org($1)", [orgId]);
    const result = await run(client);
    await client.query("ROLLBACK"); // read-only; ROLLBACK drops the pinned temp table
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
