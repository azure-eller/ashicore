import "server-only";

import { z } from "zod";
import {
  AGENT_QUERY_MAX_ROWS,
  AgentQueryValidationError,
  runAgentQuery,
} from "@/lib/dal/agent-query";
import { buildAgentTool, type AgentToolContext } from "@/lib/agent/core";
import { AuthorizationError, hasModuleAccess, type ModuleKey } from "@/lib/authz";

const QUERY_MODULES: ModuleKey[] = ["sales", "inventory", "purchasing", "manufacturing"];

const TRANSCRIPT_ROW_CAP = 50;
const TRANSCRIPT_CELL_CAP = 120;

const QUERY_DESCRIPTION = `Run one read-only SQL SELECT (Postgres) to answer any data question: locate records (ILIKE), filter, join, aggregate (GROUP BY / SUM / COUNT), sort. Always include LIMIT; at most ${AGENT_QUERY_MAX_ROWS} rows are returned. Everything is already scoped to the current organization, soft-deleted rows are already excluded, and the connection is read-only — writes are impossible.

All data is in the agent_query schema (the only tables you can read):
- agent_query.sales_orders(id, order_number, customer_id, customer_name, status 'open'|'done', priority_rank, order_date, ship_date, requested_date, due_date, is_late, shipped_at, subtotal_amount, tax_amount, total_amount, notes, created_at, updated_at)
- agent_query.sales_order_lines(id, sales_order_id, item_id, item_name, item_sku, unit_name, quantity, shipped_quantity, cancelled_quantity, unit_price, discount_percent)
- agent_query.customers(id, name, account_state, account_priority, email, phone, notes, created_at)
- agent_query.items_stock(id, name, sku, item_type 'product'|'material', category, sellable, safety_stock, unit_name, on_hand_qty, demand_qty, available_qty, expected_qty, created_at) — canonical inventory quantities
- agent_query.purchase_orders(id, order_number, supplier_id, supplier_name, status 'draft'|'ordered'|'partial'|'received', expected_date, total_amount, received_at, notes, created_at)
- agent_query.purchase_order_lines(id, purchase_order_id, item_id, quantity_ordered, quantity_received, unit_cost)
- agent_query.manufacturing_orders(id, order_number, product_id, product_name, product_sku, status 'open'|'done', is_blocked, requested_quantity, planned_quantity, actual_quantity, unit_name, number_of_batches, planned_date, sales_order_id, sales_order_number, started_at, completed_at, created_at)
- agent_query.suppliers(id, name, code, contact_name, email, phone, payment_terms, notes, created_at)
- agent_query.tax_rates(id, name, rate_percent, created_at)

Semantics: due_date is already COALESCE(ship_date, requested_date); is_late is precomputed (open and past due). Quantity and money columns are numeric. Use ILIKE '%term%' for name/code matching. To confirm exact columns, query information_schema (WHERE table_schema='agent_query').

Examples:
SELECT order_number, customer_name, total_amount FROM agent_query.sales_orders WHERE status = 'open' AND is_late ORDER BY due_date LIMIT 20
SELECT customer_name, COUNT(*) AS open_orders, SUM(total_amount) AS open_value FROM agent_query.sales_orders WHERE status = 'open' GROUP BY customer_name ORDER BY open_value DESC LIMIT 10
SELECT name, sku, on_hand_qty, safety_stock FROM agent_query.items_stock WHERE on_hand_qty < safety_stock AND safety_stock > 0 ORDER BY name LIMIT 25`;

export const queryTool = buildAgentTool({
  name: "query",
  description: QUERY_DESCRIPTION,
  inputSchema: z.object({
    sql: z.string().min(8).max(4_000),
  }),
  execute: async (input, context: AgentToolContext) => {
    const member = context.member;
    // One SQL surface spans all four schemas, and the erp_agent_ro role does not
    // enforce per-module visibility — so reading any one schema's view exposes
    // cross-module data (e.g. inventory cost). Require read on all four to use
    // the tool at all. Refining to per-module view access is a tracked follow-up.
    if (
      !member ||
      !QUERY_MODULES.every((module) => hasModuleAccess(member.assignedRoles, module, "read"))
    ) {
      throw new AuthorizationError(
        "Running reporting queries requires read access to sales, inventory, purchasing, and manufacturing.",
        403
      );
    }

    try {
      return await runAgentQuery(member.orgId, input.sql);
    } catch (error) {
      if (error instanceof AgentQueryValidationError) throw error;
      // Surface the Postgres error so the model can correct its SQL.
      throw new Error(error instanceof Error ? error.message : "Query failed.");
    }
  },
  summarize: (output) =>
    `${output.rowCount}${output.truncated ? "+" : ""} rows, ${output.columns.length} columns`,
  toModelContent: (output) => {
    if (output.rowCount === 0) return "0 rows";
    const cell = (value: unknown) => {
      const text = value == null ? "" : String(value);
      return text.length > TRANSCRIPT_CELL_CAP ? `${text.slice(0, TRANSCRIPT_CELL_CAP)}…` : text;
    };
    const lines = output.rows
      .slice(0, TRANSCRIPT_ROW_CAP)
      .map((row) => output.columns.map((column) => cell(row[column])).join(" | "));
    return [
      output.columns.join(" | "),
      ...lines,
      output.rows.length > TRANSCRIPT_ROW_CAP
        ? `(${output.rows.length - TRANSCRIPT_ROW_CAP} more rows not shown — aggregate or narrow the query)`
        : null,
      output.truncated ? `(result capped at ${AGENT_QUERY_MAX_ROWS} rows)` : null,
    ]
      .filter(Boolean)
      .join("\n");
  },
  isConcurrencySafe: () => true,
});

export const agentReadTools = [queryTool];
