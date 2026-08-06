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

const QUERY_DESCRIPTION = `Run one read-only SQL SELECT (Postgres) to answer any data question: locate records (ILIKE), filter, join, aggregate (GROUP BY / SUM / COUNT), sort. Always include LIMIT; at most ${AGENT_QUERY_MAX_ROWS} rows are returned. Every row is already scoped to the current organization and the connection is read-only — writes are impossible.

You query the real ERP tables directly across these schemas: sales, inventory, purchasing, manufacturing, settings. Most rows are soft-deleted, so add "deleted_at IS NULL" unless you want historical rows. Key tables (introspect information_schema for exact columns and any table not listed):
- sales.sales_orders (status 'open'|'done', ship_date, requested_date, total_amount, customer_name), sales.sales_order_lines, sales.customers, sales.customer_activities (one engagement stream: type 'note'|'call'|'email'|'meeting'|'task'; tasks carry due_date + status 'open'|'done'), sales.customer_projects, sales.pricing_schedules / sales.pricing_schedule_items
- inventory.items (name, sku, item_type 'product'|'material', category, safety_stock, unit_definition_id, sales_unit_definition_id, sales_to_stock_factor), inventory.unit_definitions, inventory.bom_revisions + inventory.bom_revision_components (recipes — which materials each product uses; is_current flags the active revision), inventory.lots, inventory.inventory_events (stock movement ledger), inventory.stocktakes
- purchasing.purchase_orders (status 'not_received'|'partial'|'received'), purchasing.purchase_order_lines, purchasing.suppliers, purchasing.supplier_items
- manufacturing.manufacturing_orders (status 'open'|'done', is_blocked), manufacturing.manufacturing_order_ingredients, manufacturing.manufacturing_order_batches
- settings.tax_rates

For inventory quantities ALWAYS use the view agent_query.items_stock(id, name, sku, item_type, category, sellable, safety_stock, unit_name, on_hand_qty, demand_qty, available_qty, expected_qty) — it carries the canonical kernel availability math. Do not recompute stock from inventory_lot_balances yourself.

Semantics: an order's due date = COALESCE(ship_date, requested_date); late = open AND due date < CURRENT_DATE. A material is "unused" if it appears in no current BOM (inventory.bom_revision_components joined to bom_revisions WHERE is_current). Use ILIKE '%term%' for name/code matching.
Sales-order line quantity, unit_name, and unit price are the commercial selling basis. The stock_quantity, stocking_unit_name, stock_shipped_quantity, and stock_cancelled_quantity columns are the inventory/planning basis. For a sellable item, join sales_unit_definition_id to inventory.unit_definitions to see the unit customers order; when it is null, the stocking unit is also the sales unit.

Examples:
SELECT order_number, customer_name, total_amount FROM sales.sales_orders WHERE deleted_at IS NULL AND status = 'open' AND COALESCE(ship_date, requested_date) < CURRENT_DATE ORDER BY ship_date LIMIT 20
SELECT name, sku, on_hand_qty, safety_stock FROM agent_query.items_stock WHERE on_hand_qty < safety_stock AND safety_stock > 0 ORDER BY name LIMIT 25
SELECT i.name, i.sku FROM inventory.items i WHERE i.deleted_at IS NULL AND i.item_type = 'material' AND NOT EXISTS (SELECT 1 FROM inventory.bom_revision_components c JOIN inventory.bom_revisions r ON r.id = c.bom_revision_id WHERE r.is_current AND c.component_id = i.id) ORDER BY i.name LIMIT 50`;

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
    `${output.rowCount}${output.truncated ? "+" : ""} ${output.rowCount === 1 && !output.truncated ? "row" : "rows"}, ${output.columns.length} ${output.columns.length === 1 ? "column" : "columns"}`,
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
