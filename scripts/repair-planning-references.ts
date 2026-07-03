import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db/with-org-context";
import { loadWorktreeEnv } from "./load-worktree-env";

loadWorktreeEnv();

type RepairRow = {
  location_id: string;
  item_id: string;
  reference_type: string;
  reference_id: string;
  current_quantity: string;
  target_quantity: string;
  source_state: string;
};

type Args = {
  apply: boolean;
  orgId?: string;
  orgSlug?: string;
  runId: string;
};

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const parsed: Args = { apply: false, runId: randomUUID() };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apply") {
      parsed.apply = true;
    } else if (arg === "--org-id") {
      parsed.orgId = args[++index];
    } else if (arg === "--org-slug") {
      parsed.orgSlug = args[++index];
    } else if (arg === "--run-id") {
      parsed.runId = args[++index] ?? parsed.runId;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!parsed.orgId && !parsed.orgSlug) {
    throw new Error("Pass --org-id <id> or --org-slug <slug>.");
  }

  return parsed;
}

async function resolveOrgId(
  db: typeof import("@/lib/db").db,
  organization: typeof import("@/lib/db/schema").organization,
  args: Args
) {
  if (args.orgId) return args.orgId;

  const [row] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, args.orgSlug!));

  if (!row) {
    throw new Error(`Organization not found for slug ${args.orgSlug}.`);
  }

  return row.id;
}

function rowDelta(row: RepairRow) {
  return Number(row.target_quantity) - Number(row.current_quantity);
}

function summarize(rows: RepairRow[]) {
  const byState = new Map<string, { count: number; delta: number }>();

  for (const row of rows) {
    const current = byState.get(row.source_state) ?? { count: 0, delta: 0 };
    current.count += 1;
    current.delta += rowDelta(row);
    byState.set(row.source_state, current);
  }

  return [...byState.entries()].map(([sourceState, value]) => ({
    sourceState,
    count: value.count,
    delta: Number(value.delta.toFixed(4)),
  }));
}

async function loadDemandRepairs(tx: Tx, orgId: string) {
  const result = await tx.execute(sql`
    WITH targets AS (
      SELECT
        demand.location_id,
        demand.item_id,
        demand.reference_type,
        demand.reference_id,
        demand.quantity::numeric AS current_quantity,
        CASE
          WHEN demand.reference_type = 'manufacturing_order_ingredient'
            AND ingredient.id IS NOT NULL
            AND mo.status <> 'done'
            AND mo.completed_at IS NULL
            AND mo.deleted_at IS NULL
            THEN GREATEST(ingredient.planned_quantity - ingredient.picked_quantity, 0)
          WHEN demand.reference_type = 'sales_order_line'
            AND line.id IS NOT NULL
            AND so.status <> 'done'
            AND so.deleted_at IS NULL
            THEN GREATEST(line.quantity - line.shipped_quantity - line.cancelled_quantity, 0)
          ELSE 0::numeric
        END AS target_quantity,
        CASE
          WHEN demand.reference_type = 'manufacturing_order_ingredient' AND ingredient.id IS NULL THEN 'orphan_mo_ingredient'
          WHEN demand.reference_type = 'manufacturing_order_ingredient' AND mo.deleted_at IS NOT NULL THEN 'deleted_mo'
          WHEN demand.reference_type = 'manufacturing_order_ingredient' AND (mo.status = 'done' OR mo.completed_at IS NOT NULL) THEN 'done_mo'
          WHEN demand.reference_type = 'manufacturing_order_ingredient' THEN 'active_mo_ingredient'
          WHEN demand.reference_type = 'sales_order_line' AND line.id IS NULL THEN 'orphan_sales_line'
          WHEN demand.reference_type = 'sales_order_line' AND so.deleted_at IS NOT NULL THEN 'deleted_sales_order'
          WHEN demand.reference_type = 'sales_order_line' AND so.status = 'done' THEN 'done_sales_order'
          WHEN demand.reference_type = 'sales_order_line' THEN 'active_sales_line'
          ELSE 'unknown_reference'
        END AS source_state
      FROM inventory.inventory_demands_summary demand
      LEFT JOIN manufacturing.manufacturing_order_ingredients ingredient
        ON demand.reference_type = 'manufacturing_order_ingredient'
       AND ingredient.id = demand.reference_id
      LEFT JOIN manufacturing.manufacturing_orders mo
        ON mo.id = ingredient.manufacturing_order_id
      LEFT JOIN sales.sales_order_lines line
        ON demand.reference_type = 'sales_order_line'
       AND line.id = demand.reference_id
      LEFT JOIN sales.sales_orders so
        ON so.id = line.sales_order_id
      WHERE demand.organization_id = ${orgId}
    )
    SELECT
      location_id,
      item_id,
      reference_type,
      reference_id,
      ROUND(current_quantity, 4)::text AS current_quantity,
      ROUND(target_quantity, 4)::text AS target_quantity,
      source_state
    FROM targets
    WHERE ROUND(current_quantity, 4) <> ROUND(target_quantity, 4)
    ORDER BY ABS(current_quantity - target_quantity) DESC
  `);

  return result.rows as RepairRow[];
}

async function loadExpectedRepairs(tx: Tx, orgId: string) {
  const result = await tx.execute(sql`
    WITH targets AS (
      SELECT
        expected.location_id,
        expected.item_id,
        expected.reference_type,
        expected.reference_id,
        expected.quantity::numeric AS current_quantity,
        CASE
          WHEN expected.reference_type = 'manufacturing_order'
            AND mo.id IS NOT NULL
            AND mo.status <> 'done'
            AND mo.completed_at IS NULL
            AND mo.deleted_at IS NULL
            THEN GREATEST(mo.planned_quantity - COALESCE(mo.actual_quantity, 0), 0)
          WHEN expected.reference_type = 'purchase_order_line'
            AND line.id IS NOT NULL
            AND po.status IN ('not_received', 'partial')
            AND po.deleted_at IS NULL
            THEN GREATEST(line.stock_quantity_ordered - line.stock_quantity_received, 0)
          ELSE 0::numeric
        END AS target_quantity,
        CASE
          WHEN expected.reference_type = 'manufacturing_order' AND mo.id IS NULL THEN 'orphan_mo'
          WHEN expected.reference_type = 'manufacturing_order' AND mo.deleted_at IS NOT NULL THEN 'deleted_mo'
          WHEN expected.reference_type = 'manufacturing_order' AND (mo.status = 'done' OR mo.completed_at IS NOT NULL) THEN 'done_mo'
          WHEN expected.reference_type = 'manufacturing_order' THEN 'active_mo'
          WHEN expected.reference_type = 'purchase_order_line' AND line.id IS NULL THEN 'orphan_po_line'
          WHEN expected.reference_type = 'purchase_order_line' AND po.deleted_at IS NOT NULL THEN 'deleted_po'
          WHEN expected.reference_type = 'purchase_order_line' AND po.status = 'received' THEN 'closed_po'
          WHEN expected.reference_type = 'purchase_order_line' THEN 'active_po_line'
          ELSE 'unknown_reference'
        END AS source_state
      FROM inventory.inventory_expected_summary expected
      LEFT JOIN manufacturing.manufacturing_orders mo
        ON expected.reference_type = 'manufacturing_order'
       AND mo.id = expected.reference_id
      LEFT JOIN purchasing.purchase_order_lines line
        ON expected.reference_type = 'purchase_order_line'
       AND line.id = expected.reference_id
      LEFT JOIN purchasing.purchase_orders po
        ON po.id = line.purchase_order_id
      WHERE expected.organization_id = ${orgId}
    )
    SELECT
      location_id,
      item_id,
      reference_type,
      reference_id,
      ROUND(current_quantity, 4)::text AS current_quantity,
      ROUND(target_quantity, 4)::text AS target_quantity,
      source_state
    FROM targets
    WHERE ROUND(current_quantity, 4) <> ROUND(target_quantity, 4)
    ORDER BY ABS(current_quantity - target_quantity) DESC
  `);

  return result.rows as RepairRow[];
}

async function applyDemandRepairs(
  tx: Tx,
  applyDemandReferenceDeltasInTx: typeof import("@/lib/inventory/kernel").applyDemandReferenceDeltasInTx,
  orgId: string,
  runId: string,
  rows: RepairRow[]
) {
  for (const row of rows) {
    await applyDemandReferenceDeltasInTx(tx, {
      organizationId: orgId,
      locationId: row.location_id,
      eventSubtype: "data_repair",
      deltas: [
        {
          itemId: row.item_id,
          referenceType: row.reference_type,
          referenceId: row.reference_id,
          quantity: rowDelta(row),
          metadata: {
            reason: "planning_reference_repair",
            runId,
            direction: "demand",
            previousQuantity: row.current_quantity,
            targetQuantity: row.target_quantity,
            sourceState: row.source_state,
          },
        },
      ],
    });
  }
}

async function applyExpectedRepairs(
  tx: Tx,
  applyExpectedReferenceDeltasInTx: typeof import("@/lib/inventory/kernel").applyExpectedReferenceDeltasInTx,
  orgId: string,
  runId: string,
  rows: RepairRow[]
) {
  for (const row of rows) {
    await applyExpectedReferenceDeltasInTx(tx, {
      organizationId: orgId,
      locationId: row.location_id,
      eventSubtype: "data_repair",
      deltas: [
        {
          itemId: row.item_id,
          referenceType: row.reference_type,
          referenceId: row.reference_id,
          quantity: rowDelta(row),
          metadata: {
            reason: "planning_reference_repair",
            runId,
            direction: "expected",
            previousQuantity: row.current_quantity,
            targetQuantity: row.target_quantity,
            sourceState: row.source_state,
          },
        },
      ],
    });
  }
}

async function main() {
  const [{ db }, { organization }, kernel] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/db/schema"),
    import("@/lib/inventory/kernel"),
  ]);
  const args = parseArgs();
  const orgId = await resolveOrgId(db, organization, args);

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
    const demand = await loadDemandRepairs(tx as Tx, orgId);
    const expected = await loadExpectedRepairs(tx as Tx, orgId);

    if (args.apply) {
      await applyDemandRepairs(
        tx as Tx,
        kernel.applyDemandReferenceDeltasInTx,
        orgId,
        args.runId,
        demand
      );
      await applyExpectedRepairs(
        tx as Tx,
        kernel.applyExpectedReferenceDeltasInTx,
        orgId,
        args.runId,
        expected
      );
    }

    return { demand, expected };
  });

  console.log(
    JSON.stringify(
      {
        orgId,
        mode: args.apply ? "apply" : "dry-run",
        runId: args.runId,
        demand: {
          count: result.demand.length,
          byState: summarize(result.demand),
          sample: result.demand.slice(0, 10),
        },
        expected: {
          count: result.expected.length,
          byState: summarize(result.expected),
          sample: result.expected.slice(0, 10),
        },
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
