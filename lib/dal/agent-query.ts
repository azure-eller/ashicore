import "server-only";

import { runOnAgentConnection } from "@/lib/db/agent-pool";

export const AGENT_QUERY_MAX_ROWS = 200;
const STATEMENT_TIMEOUT_MS = 3_000;

export type AgentQueryResult = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
};

export class AgentQueryValidationError extends Error {}

/**
 * Read-only SQL for the agent. Security is enforced by the database, not by this
 * validation (see lib/db/agent-pool.ts and the 0154 migration): a dedicated
 * erp_agent_ro login with SELECT on agent_query.* views only, org pinned
 * immutably per request. This check is a thin first line — reject anything that
 * is not a single SELECT/WITH so obvious mistakes fail fast and cheap.
 */
function validateAgentSql(input: string) {
  const trimmed = input.trim().replace(/;\s*$/, "");
  if (!/^(select|with)\b/i.test(trimmed)) {
    throw new AgentQueryValidationError(
      "Only a single SELECT (or WITH … SELECT) statement is allowed."
    );
  }
  if (trimmed.includes(";")) {
    throw new AgentQueryValidationError("Multiple SQL statements are not allowed.");
  }
  return trimmed;
}

export async function runAgentQuery(orgId: string, input: string): Promise<AgentQueryResult> {
  const statement = validateAgentSql(input);
  // Enforce the row cap in SQL, not just after fetch: wrapping the model's query
  // makes Postgres stop after the cap even if the query omits LIMIT, so a
  // LIMIT-less scan of a large table never streams the whole set into the server.
  // A tighter inner LIMIT still wins; the +1 lets us flag truncation.
  const capped = `SELECT * FROM (${statement}) AS agent_result LIMIT ${AGENT_QUERY_MAX_ROWS + 1}`;

  return runOnAgentConnection(orgId, STATEMENT_TIMEOUT_MS, async (client) => {
    const result = await client.query(capped);
    const allRows = (result.rows ?? []) as Array<Record<string, unknown>>;
    const truncated = allRows.length > AGENT_QUERY_MAX_ROWS;
    const rows = truncated ? allRows.slice(0, AGENT_QUERY_MAX_ROWS) : allRows;

    return {
      columns: rows[0] ? Object.keys(rows[0]) : [],
      rows,
      rowCount: rows.length,
      truncated,
    };
  });
}
