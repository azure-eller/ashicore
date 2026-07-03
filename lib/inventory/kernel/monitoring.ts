import { asc, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { organization } from "@/lib/db/schema";
import { diffProjections } from "./reconcile";

export type InventoryProjectionDiff = Awaited<ReturnType<typeof diffProjections>>;

export type InventoryProjectionDiffSummary = {
  itemDeltas: number;
  lotDeltas: number;
  demandDeltas: number;
  expectedDeltas: number;
  legacyLotDeltas: number;
};

export type InventoryProjectionDiffResult = {
  orgId: string;
  ok: boolean;
  summary: InventoryProjectionDiffSummary;
  diff: InventoryProjectionDiff;
};

export type InventoryPlanningIntegritySummary = {
  negativeDemandReferences: number;
  negativeExpectedReferences: number;
  orphanDemandReferences: number;
  orphanExpectedReferences: number;
  inactiveDemandReferences: number;
  inactiveExpectedReferences: number;
  overTargetDemandReferences: number;
  overTargetExpectedReferences: number;
};

export type InventoryPlanningIntegrityResult = {
  ok: boolean;
  summary: InventoryPlanningIntegritySummary;
  violations: {
    negativeDemandReferences: unknown[];
    negativeExpectedReferences: unknown[];
    orphanDemandReferences: unknown[];
    orphanExpectedReferences: unknown[];
    inactiveDemandReferences: unknown[];
    inactiveExpectedReferences: unknown[];
    overTargetDemandReferences: unknown[];
    overTargetExpectedReferences: unknown[];
  };
};

export function summarizeProjectionDiff(
  diff: InventoryProjectionDiff
): InventoryProjectionDiffSummary {
  return {
    itemDeltas: diff.itemDeltas.length,
    lotDeltas: diff.lotDeltas.length,
    demandDeltas: diff.demandDeltas.length,
    expectedDeltas: diff.expectedDeltas.length,
    legacyLotDeltas: diff.legacyLotDeltas.length,
  };
}

export async function diffInventoryStateForOrg(
  orgId: string,
  itemIds?: string[]
): Promise<InventoryProjectionDiffResult> {
  const diff = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
    return diffProjections(tx, orgId, itemIds);
  });
  const summary = summarizeProjectionDiff(diff);

  return {
    orgId,
    ok: !Object.values(summary).some((count) => count > 0),
    summary,
    diff,
  };
}

export async function checkInventoryPlanningIntegrityForOrg(
  orgId: string
): Promise<InventoryPlanningIntegrityResult> {
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);

    const negativeDemandReferences = await tx.execute(sql`
      SELECT item_id, reference_type, reference_id, ROUND(quantity::numeric, 4) AS quantity
      FROM inventory.inventory_demands_summary
      WHERE organization_id = ${orgId}
        AND ROUND(quantity::numeric, 4) < 0
      ORDER BY ABS(quantity::numeric) DESC
      LIMIT 50
    `);
    const negativeDemandReferenceCount = await tx.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM inventory.inventory_demands_summary
      WHERE organization_id = ${orgId}
        AND ROUND(quantity::numeric, 4) < 0
    `);

    const negativeExpectedReferences = await tx.execute(sql`
      SELECT item_id, reference_type, reference_id, ROUND(quantity::numeric, 4) AS quantity
      FROM inventory.inventory_expected_summary
      WHERE organization_id = ${orgId}
        AND ROUND(quantity::numeric, 4) < 0
      ORDER BY ABS(quantity::numeric) DESC
      LIMIT 50
    `);
    const negativeExpectedReferenceCount = await tx.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM inventory.inventory_expected_summary
      WHERE organization_id = ${orgId}
        AND ROUND(quantity::numeric, 4) < 0
    `);

    const orphanDemandReferences = await tx.execute(sql`
      SELECT demand.item_id, demand.reference_type, demand.reference_id, ROUND(demand.quantity::numeric, 4) AS quantity
      FROM inventory.inventory_demands_summary demand
      LEFT JOIN manufacturing.manufacturing_order_ingredients ingredient
        ON demand.reference_type = 'manufacturing_order_ingredient'
       AND ingredient.id = demand.reference_id
      LEFT JOIN sales.sales_order_lines line
        ON demand.reference_type = 'sales_order_line'
       AND line.id = demand.reference_id
      WHERE demand.organization_id = ${orgId}
        AND (
          (demand.reference_type = 'manufacturing_order_ingredient' AND ingredient.id IS NULL)
          OR (demand.reference_type = 'sales_order_line' AND line.id IS NULL)
        )
        AND ROUND(demand.quantity::numeric, 4) <> 0
      ORDER BY ABS(demand.quantity::numeric) DESC
      LIMIT 50
    `);
    const orphanDemandReferenceCount = await tx.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM inventory.inventory_demands_summary demand
      LEFT JOIN manufacturing.manufacturing_order_ingredients ingredient
        ON demand.reference_type = 'manufacturing_order_ingredient'
       AND ingredient.id = demand.reference_id
      LEFT JOIN sales.sales_order_lines line
        ON demand.reference_type = 'sales_order_line'
       AND line.id = demand.reference_id
      WHERE demand.organization_id = ${orgId}
        AND (
          (demand.reference_type = 'manufacturing_order_ingredient' AND ingredient.id IS NULL)
          OR (demand.reference_type = 'sales_order_line' AND line.id IS NULL)
        )
        AND ROUND(demand.quantity::numeric, 4) <> 0
    `);

    const orphanExpectedReferences = await tx.execute(sql`
      SELECT expected.item_id, expected.reference_type, expected.reference_id, ROUND(expected.quantity::numeric, 4) AS quantity
      FROM inventory.inventory_expected_summary expected
      LEFT JOIN manufacturing.manufacturing_orders mo
        ON expected.reference_type = 'manufacturing_order'
       AND mo.id = expected.reference_id
      LEFT JOIN purchasing.purchase_order_lines line
        ON expected.reference_type = 'purchase_order_line'
       AND line.id = expected.reference_id
      WHERE expected.organization_id = ${orgId}
        AND (
          (expected.reference_type = 'manufacturing_order' AND mo.id IS NULL)
          OR (expected.reference_type = 'purchase_order_line' AND line.id IS NULL)
        )
        AND ROUND(expected.quantity::numeric, 4) <> 0
      ORDER BY ABS(expected.quantity::numeric) DESC
      LIMIT 50
    `);
    const orphanExpectedReferenceCount = await tx.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM inventory.inventory_expected_summary expected
      LEFT JOIN manufacturing.manufacturing_orders mo
        ON expected.reference_type = 'manufacturing_order'
       AND mo.id = expected.reference_id
      LEFT JOIN purchasing.purchase_order_lines line
        ON expected.reference_type = 'purchase_order_line'
       AND line.id = expected.reference_id
      WHERE expected.organization_id = ${orgId}
        AND (
          (expected.reference_type = 'manufacturing_order' AND mo.id IS NULL)
          OR (expected.reference_type = 'purchase_order_line' AND line.id IS NULL)
        )
        AND ROUND(expected.quantity::numeric, 4) <> 0
    `);

    const inactiveDemandReferences = await tx.execute(sql`
      WITH demand_sources AS (
        SELECT
          demand.item_id,
          demand.reference_type,
          demand.reference_id,
          ROUND(demand.quantity::numeric, 4) AS quantity,
          CASE
            WHEN demand.reference_type = 'manufacturing_order_ingredient'
              THEN mo.status = 'done' OR mo.completed_at IS NOT NULL OR mo.deleted_at IS NOT NULL
            WHEN demand.reference_type = 'sales_order_line'
              THEN so.status = 'done' OR so.deleted_at IS NOT NULL
            ELSE false
          END AS inactive
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
      SELECT item_id, reference_type, reference_id, quantity
      FROM demand_sources
      WHERE inactive IS TRUE
        AND quantity <> 0
      ORDER BY ABS(quantity::numeric) DESC
      LIMIT 50
    `);
    const inactiveDemandReferenceCount = await tx.execute(sql`
      WITH demand_sources AS (
        SELECT
          demand.quantity,
          CASE
            WHEN demand.reference_type = 'manufacturing_order_ingredient'
              THEN mo.status = 'done' OR mo.completed_at IS NOT NULL OR mo.deleted_at IS NOT NULL
            WHEN demand.reference_type = 'sales_order_line'
              THEN so.status = 'done' OR so.deleted_at IS NOT NULL
            ELSE false
          END AS inactive
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
      SELECT COUNT(*)::int AS count
      FROM demand_sources
      WHERE inactive IS TRUE
        AND ROUND(quantity::numeric, 4) <> 0
    `);

    const inactiveExpectedReferences = await tx.execute(sql`
      WITH expected_sources AS (
        SELECT
          expected.item_id,
          expected.reference_type,
          expected.reference_id,
          ROUND(expected.quantity::numeric, 4) AS quantity,
          CASE
            WHEN expected.reference_type = 'manufacturing_order'
              THEN mo.status = 'done' OR mo.completed_at IS NOT NULL OR mo.deleted_at IS NOT NULL
            WHEN expected.reference_type = 'purchase_order_line'
              THEN po.status = 'received' OR po.deleted_at IS NOT NULL
            ELSE false
          END AS inactive
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
      SELECT item_id, reference_type, reference_id, quantity
      FROM expected_sources
      WHERE inactive IS TRUE
        AND quantity <> 0
      ORDER BY ABS(quantity::numeric) DESC
      LIMIT 50
    `);
    const inactiveExpectedReferenceCount = await tx.execute(sql`
      WITH expected_sources AS (
        SELECT
          expected.quantity,
          CASE
            WHEN expected.reference_type = 'manufacturing_order'
              THEN mo.status = 'done' OR mo.completed_at IS NOT NULL OR mo.deleted_at IS NOT NULL
            WHEN expected.reference_type = 'purchase_order_line'
              THEN po.status = 'received' OR po.deleted_at IS NOT NULL
            ELSE false
          END AS inactive
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
      SELECT COUNT(*)::int AS count
      FROM expected_sources
      WHERE inactive IS TRUE
        AND ROUND(quantity::numeric, 4) <> 0
    `);

    const overTargetDemandReferences = await tx.execute(sql`
      WITH targets AS (
        SELECT
          demand.item_id,
          demand.reference_type,
          demand.reference_id,
          ROUND(demand.quantity::numeric, 4) AS quantity,
          CASE
            WHEN demand.reference_type = 'manufacturing_order_ingredient'
              THEN GREATEST(ingredient.planned_quantity - ingredient.picked_quantity, 0)
            WHEN demand.reference_type = 'sales_order_line'
              THEN GREATEST(line.quantity - line.shipped_quantity - line.cancelled_quantity, 0)
            ELSE NULL
          END AS target_quantity
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
          AND (
            (demand.reference_type = 'manufacturing_order_ingredient'
              AND ingredient.id IS NOT NULL
              AND mo.status <> 'done'
              AND mo.completed_at IS NULL
              AND mo.deleted_at IS NULL)
            OR (demand.reference_type = 'sales_order_line'
              AND line.id IS NOT NULL
              AND so.status <> 'done'
              AND so.deleted_at IS NULL)
          )
      )
      SELECT item_id, reference_type, reference_id, quantity, ROUND(target_quantity::numeric, 4) AS target_quantity
      FROM targets
      WHERE target_quantity IS NOT NULL
        AND quantity > ROUND(target_quantity::numeric, 4) + 0.0001
      ORDER BY (quantity - target_quantity)::numeric DESC
      LIMIT 50
    `);
    const overTargetDemandReferenceCount = await tx.execute(sql`
      WITH targets AS (
        SELECT
          demand.quantity,
          CASE
            WHEN demand.reference_type = 'manufacturing_order_ingredient'
              THEN GREATEST(ingredient.planned_quantity - ingredient.picked_quantity, 0)
            WHEN demand.reference_type = 'sales_order_line'
              THEN GREATEST(line.quantity - line.shipped_quantity - line.cancelled_quantity, 0)
            ELSE NULL
          END AS target_quantity
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
          AND (
            (demand.reference_type = 'manufacturing_order_ingredient'
              AND ingredient.id IS NOT NULL
              AND mo.status <> 'done'
              AND mo.completed_at IS NULL
              AND mo.deleted_at IS NULL)
            OR (demand.reference_type = 'sales_order_line'
              AND line.id IS NOT NULL
              AND so.status <> 'done'
              AND so.deleted_at IS NULL)
          )
      )
      SELECT COUNT(*)::int AS count
      FROM targets
      WHERE target_quantity IS NOT NULL
        AND ROUND(quantity::numeric, 4) > ROUND(target_quantity::numeric, 4) + 0.0001
    `);

    const overTargetExpectedReferences = await tx.execute(sql`
      WITH targets AS (
        SELECT
          expected.item_id,
          expected.reference_type,
          expected.reference_id,
          ROUND(expected.quantity::numeric, 4) AS quantity,
          CASE
            WHEN expected.reference_type = 'manufacturing_order'
              THEN GREATEST(mo.planned_quantity - COALESCE(mo.actual_quantity, 0), 0)
            WHEN expected.reference_type = 'purchase_order_line'
              THEN GREATEST(line.stock_quantity_ordered - line.stock_quantity_received, 0)
            ELSE NULL
          END AS target_quantity
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
          AND (
            (expected.reference_type = 'manufacturing_order'
              AND mo.id IS NOT NULL
              AND mo.status <> 'done'
              AND mo.completed_at IS NULL
              AND mo.deleted_at IS NULL)
            OR (expected.reference_type = 'purchase_order_line'
              AND line.id IS NOT NULL
              AND po.status IN ('not_received', 'partial')
              AND po.deleted_at IS NULL)
          )
      )
      SELECT item_id, reference_type, reference_id, quantity, ROUND(target_quantity::numeric, 4) AS target_quantity
      FROM targets
      WHERE target_quantity IS NOT NULL
        AND quantity > ROUND(target_quantity::numeric, 4) + 0.0001
      ORDER BY (quantity - target_quantity)::numeric DESC
      LIMIT 50
    `);
    const overTargetExpectedReferenceCount = await tx.execute(sql`
      WITH targets AS (
        SELECT
          expected.quantity,
          CASE
            WHEN expected.reference_type = 'manufacturing_order'
              THEN GREATEST(mo.planned_quantity - COALESCE(mo.actual_quantity, 0), 0)
            WHEN expected.reference_type = 'purchase_order_line'
              THEN GREATEST(line.stock_quantity_ordered - line.stock_quantity_received, 0)
            ELSE NULL
          END AS target_quantity
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
          AND (
            (expected.reference_type = 'manufacturing_order'
              AND mo.id IS NOT NULL
              AND mo.status <> 'done'
              AND mo.completed_at IS NULL
              AND mo.deleted_at IS NULL)
            OR (expected.reference_type = 'purchase_order_line'
              AND line.id IS NOT NULL
              AND po.status IN ('not_received', 'partial')
              AND po.deleted_at IS NULL)
          )
      )
      SELECT COUNT(*)::int AS count
      FROM targets
      WHERE target_quantity IS NOT NULL
        AND ROUND(quantity::numeric, 4) > ROUND(target_quantity::numeric, 4) + 0.0001
    `);

    return {
      counts: {
        negativeDemandReferences: Number(negativeDemandReferenceCount.rows[0]?.count ?? 0),
        negativeExpectedReferences: Number(negativeExpectedReferenceCount.rows[0]?.count ?? 0),
        orphanDemandReferences: Number(orphanDemandReferenceCount.rows[0]?.count ?? 0),
        orphanExpectedReferences: Number(orphanExpectedReferenceCount.rows[0]?.count ?? 0),
        inactiveDemandReferences: Number(inactiveDemandReferenceCount.rows[0]?.count ?? 0),
        inactiveExpectedReferences: Number(inactiveExpectedReferenceCount.rows[0]?.count ?? 0),
        overTargetDemandReferences: Number(overTargetDemandReferenceCount.rows[0]?.count ?? 0),
        overTargetExpectedReferences: Number(overTargetExpectedReferenceCount.rows[0]?.count ?? 0),
      },
      negativeDemandReferences: negativeDemandReferences.rows,
      negativeExpectedReferences: negativeExpectedReferences.rows,
      orphanDemandReferences: orphanDemandReferences.rows,
      orphanExpectedReferences: orphanExpectedReferences.rows,
      inactiveDemandReferences: inactiveDemandReferences.rows,
      inactiveExpectedReferences: inactiveExpectedReferences.rows,
      overTargetDemandReferences: overTargetDemandReferences.rows,
      overTargetExpectedReferences: overTargetExpectedReferences.rows,
    };
  });

  const { counts: summary, ...violations } = result;

  return {
    ok: !Object.values(summary).some((count) => count > 0),
    summary,
    violations,
  };
}

export async function listOrganizationIds(orgIds?: string[]) {
  const query = db
    .select({ id: organization.id })
    .from(organization)
    .orderBy(asc(organization.createdAt));

  const rows =
    orgIds && orgIds.length > 0
      ? await query.where(inArray(organization.id, orgIds))
      : await query;

  return rows.map((row) => row.id);
}

export async function diffInventoryStateForOrganizations(orgIds?: string[]) {
  const ids = await listOrganizationIds(orgIds);
  const results: InventoryProjectionDiffResult[] = [];

  for (const orgId of ids) {
    results.push(await diffInventoryStateForOrg(orgId));
  }

  return results;
}
