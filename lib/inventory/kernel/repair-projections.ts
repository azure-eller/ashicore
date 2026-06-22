import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { items } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { diffProjections } from "./reconcile";
import { summarizeProjectionDiff } from "./monitoring";

type ProjectionRepairMode = "dry-run" | "apply";

type RepairCountRow = {
  count: number | string;
};

export type InventoryProjectionRepairSummary = {
  itemRows: number;
  lotRows: number;
  legacyLotRows: number;
  unrepairedDemandDeltas: number;
  unrepairedExpectedDeltas: number;
};

export type InventoryProjectionRepairResult = {
  orgId: string;
  mode: ProjectionRepairMode;
  before: Awaited<ReturnType<typeof diffProjections>>;
  beforeSummary: ReturnType<typeof summarizeProjectionDiff>;
  after: Awaited<ReturnType<typeof diffProjections>>;
  afterSummary: ReturnType<typeof summarizeProjectionDiff>;
  repaired: InventoryProjectionRepairSummary;
};

function countRows(result: { rows: Record<string, unknown>[] }) {
  const [row] = result.rows as RepairCountRow[];
  return Number(row?.count ?? 0);
}

function itemScope(itemIds?: string[]) {
  if (!itemIds || itemIds.length === 0) {
    return sql``;
  }

  return sql`AND item_id = ANY(ARRAY[${sql.join(
    itemIds.map((itemId) => sql`${itemId}`),
    sql`, `
  )}]::uuid[])`;
}

function eventItemScope(itemIds?: string[]) {
  if (!itemIds || itemIds.length === 0) {
    return sql``;
  }

  return sql`AND e.item_id = ANY(ARRAY[${sql.join(
    itemIds.map((itemId) => sql`${itemId}`),
    sql`, `
  )}]::uuid[])`;
}

async function lockRepairScopeInTx(
  tx: Tx,
  orgId: string,
  itemIds?: string[]
) {
  if (itemIds && itemIds.length > 0) {
    await tx
      .select({ id: items.id })
      .from(items)
      .where(
        sql`${items.organizationId} = ${orgId}
          AND ${items.id} = ANY(ARRAY[${sql.join(
            [...new Set(itemIds)].sort().map((itemId) => sql`${itemId}`),
            sql`, `
          )}]::uuid[])`
      )
      .orderBy(asc(items.id))
      .for("update");
    return;
  }

  await tx
    .select({ id: items.id })
    .from(items)
    .where(eq(items.organizationId, orgId))
    .orderBy(asc(items.id))
    .for("update");
}

async function repairLotProjectionRowsInTx(
  tx: Tx,
  orgId: string,
  itemIds?: string[]
) {
  const filter = eventItemScope(itemIds);
  const storedFilter = itemScope(itemIds);

  const upserted = await tx.execute(sql`
    WITH lot_ledger AS (
      SELECT
        e.organization_id,
        e.location_id,
        e.lot_id,
        e.item_id,
        COALESCE(e.to_disposition, e.disposition, 'available') AS disposition,
        e.quantity AS signed_quantity,
        e.id AS event_id,
        e.occurred_at,
        e.unit_cost
      FROM inventory.inventory_events e
      WHERE e.organization_id = ${orgId}
        AND e.lot_id IS NOT NULL
        ${filter}
        AND e.event_type IN (
          'opening_balance',
          'purchase_receipt',
          'manufacturing_output',
          'manual_adjustment_increase',
          'stocktake_gain',
          'manufacturing_variance_gain',
          'unpick_restock',
          'transfer_in'
        )

      UNION ALL

      SELECT
        e.organization_id,
        e.location_id,
        e.lot_id,
        e.item_id,
        COALESCE(e.from_disposition, e.disposition, 'available') AS disposition,
        -e.quantity AS signed_quantity,
        e.id AS event_id,
        e.occurred_at,
        e.unit_cost
      FROM inventory.inventory_events e
      WHERE e.organization_id = ${orgId}
        AND e.lot_id IS NOT NULL
        ${filter}
        AND e.event_type IN (
          'manual_adjustment_decrease',
          'stocktake_loss',
          'sales_consumption',
          'manufacturing_ingredient_consumption',
          'manufacturing_variance_loss',
          'quality_scrap',
          'transfer_out'
        )

      UNION ALL

      SELECT
        e.organization_id,
        e.location_id,
        e.lot_id,
        e.item_id,
        e.from_disposition AS disposition,
        -e.quantity AS signed_quantity,
        e.id AS event_id,
        e.occurred_at,
        e.unit_cost
      FROM inventory.inventory_events e
      WHERE e.organization_id = ${orgId}
        AND e.lot_id IS NOT NULL
        ${filter}
        AND e.event_type = 'quality_disposition_change'

      UNION ALL

      SELECT
        e.organization_id,
        e.location_id,
        e.lot_id,
        e.item_id,
        e.to_disposition AS disposition,
        e.quantity AS signed_quantity,
        e.id AS event_id,
        e.occurred_at,
        e.unit_cost
      FROM inventory.inventory_events e
      WHERE e.organization_id = ${orgId}
        AND e.lot_id IS NOT NULL
        ${filter}
        AND e.event_type = 'quality_disposition_change'
    ),
    lot_totals AS (
      SELECT
        organization_id,
        location_id,
        lot_id,
        item_id,
        disposition,
        ROUND(SUM(signed_quantity), 4) AS quantity
      FROM lot_ledger
      GROUP BY organization_id, location_id, lot_id, item_id, disposition
      HAVING ROUND(SUM(signed_quantity), 4) <> 0
    ),
    lot_origins AS (
      SELECT DISTINCT ON (
        organization_id,
        location_id,
        lot_id,
        item_id,
        disposition
      )
        organization_id,
        location_id,
        lot_id,
        item_id,
        disposition,
        event_id,
        occurred_at,
        unit_cost
      FROM lot_ledger
      ORDER BY
        organization_id,
        location_id,
        lot_id,
        item_id,
        disposition,
        occurred_at,
        event_id
    ),
    changed AS (
      INSERT INTO inventory.inventory_lot_balances (
        organization_id,
        location_id,
        lot_id,
        item_id,
        disposition,
        quantity,
        unit_cost,
        received_at,
        origin_event_id,
        still_active,
        updated_at
      )
      SELECT
        t.organization_id,
        t.location_id,
        t.lot_id,
        t.item_id,
        t.disposition,
        t.quantity,
        o.unit_cost,
        o.occurred_at,
        o.event_id,
        t.quantity > 0,
        NOW()
      FROM lot_totals t
      JOIN lot_origins o
        ON o.organization_id = t.organization_id
       AND o.location_id = t.location_id
       AND o.lot_id = t.lot_id
       AND o.item_id = t.item_id
       AND o.disposition = t.disposition
      ON CONFLICT (
        organization_id,
        item_id,
        location_id,
        lot_id,
        disposition
      )
      DO UPDATE SET
        quantity = EXCLUDED.quantity,
        unit_cost = COALESCE(EXCLUDED.unit_cost, inventory.inventory_lot_balances.unit_cost),
        received_at = EXCLUDED.received_at,
        origin_event_id = EXCLUDED.origin_event_id,
        still_active = EXCLUDED.quantity > 0,
        updated_at = NOW()
      WHERE ROUND(inventory.inventory_lot_balances.quantity::numeric, 4)
          IS DISTINCT FROM EXCLUDED.quantity
      RETURNING 1
    )
    SELECT COUNT(*)::int AS count
    FROM changed
  `);

  const zeroed = await tx.execute(sql`
    WITH lot_ledger AS (
      SELECT
        e.organization_id,
        e.location_id,
        e.lot_id,
        e.item_id,
        COALESCE(e.to_disposition, e.disposition, 'available') AS disposition,
        e.quantity AS signed_quantity
      FROM inventory.inventory_events e
      WHERE e.organization_id = ${orgId}
        AND e.lot_id IS NOT NULL
        ${filter}
        AND e.event_type IN (
          'opening_balance',
          'purchase_receipt',
          'manufacturing_output',
          'manual_adjustment_increase',
          'stocktake_gain',
          'manufacturing_variance_gain',
          'unpick_restock',
          'transfer_in'
        )

      UNION ALL

      SELECT
        e.organization_id,
        e.location_id,
        e.lot_id,
        e.item_id,
        COALESCE(e.from_disposition, e.disposition, 'available') AS disposition,
        -e.quantity AS signed_quantity
      FROM inventory.inventory_events e
      WHERE e.organization_id = ${orgId}
        AND e.lot_id IS NOT NULL
        ${filter}
        AND e.event_type IN (
          'manual_adjustment_decrease',
          'stocktake_loss',
          'sales_consumption',
          'manufacturing_ingredient_consumption',
          'manufacturing_variance_loss',
          'quality_scrap',
          'transfer_out'
        )

      UNION ALL

      SELECT
        e.organization_id,
        e.location_id,
        e.lot_id,
        e.item_id,
        e.from_disposition AS disposition,
        -e.quantity AS signed_quantity
      FROM inventory.inventory_events e
      WHERE e.organization_id = ${orgId}
        AND e.lot_id IS NOT NULL
        ${filter}
        AND e.event_type = 'quality_disposition_change'

      UNION ALL

      SELECT
        e.organization_id,
        e.location_id,
        e.lot_id,
        e.item_id,
        e.to_disposition AS disposition,
        e.quantity AS signed_quantity
      FROM inventory.inventory_events e
      WHERE e.organization_id = ${orgId}
        AND e.lot_id IS NOT NULL
        ${filter}
        AND e.event_type = 'quality_disposition_change'
    ),
    lot_totals AS (
      SELECT
        organization_id,
        location_id,
        lot_id,
        item_id,
        disposition,
        ROUND(SUM(signed_quantity), 4) AS quantity
      FROM lot_ledger
      GROUP BY organization_id, location_id, lot_id, item_id, disposition
      HAVING ROUND(SUM(signed_quantity), 4) <> 0
    ),
    changed AS (
      UPDATE inventory.inventory_lot_balances b
      SET
        quantity = 0,
        still_active = false,
        updated_at = NOW()
      WHERE b.organization_id = ${orgId}
        ${storedFilter}
        AND ROUND(b.quantity::numeric, 4) <> 0
        AND NOT EXISTS (
          SELECT 1
          FROM lot_totals t
          WHERE t.organization_id = b.organization_id
            AND t.location_id = b.location_id
            AND t.lot_id = b.lot_id
            AND t.item_id = b.item_id
            AND t.disposition = b.disposition
        )
      RETURNING 1
    )
    SELECT COUNT(*)::int AS count
    FROM changed
  `);

  return countRows(upserted) + countRows(zeroed);
}

async function repairItemProjectionRowsInTx(
  tx: Tx,
  orgId: string,
  itemIds?: string[]
) {
  const filter = eventItemScope(itemIds);
  const storedFilter = itemScope(itemIds);

  const upserted = await tx.execute(sql`
    WITH event_totals AS (
      SELECT
        e.organization_id,
        e.location_id,
        e.item_id,
        ROUND(SUM(
          CASE
            WHEN e.event_type IN (
              'opening_balance',
              'purchase_receipt',
              'manufacturing_output',
              'manual_adjustment_increase',
              'stocktake_gain',
              'manufacturing_variance_gain',
              'unpick_restock',
              'transfer_in'
            ) THEN e.quantity
            WHEN e.event_type IN (
              'manual_adjustment_decrease',
              'stocktake_loss',
              'sales_consumption',
              'manufacturing_ingredient_consumption',
              'manufacturing_variance_loss',
              'quality_scrap',
              'transfer_out'
            ) THEN -e.quantity
            ELSE 0
          END
        ), 4) AS on_hand_qty,
        ROUND(SUM(
          CASE
            WHEN e.event_type = 'demand_increase' THEN e.quantity
            WHEN e.event_type = 'demand_release' THEN -e.quantity
            ELSE 0
          END
        ), 4) AS demand_qty,
        ROUND(SUM(
          CASE
            WHEN e.event_type = 'expected_increase' THEN e.quantity
            WHEN e.event_type = 'expected_release' THEN -e.quantity
            ELSE 0
          END
        ), 4) AS expected_qty
      FROM inventory.inventory_events e
      WHERE e.organization_id = ${orgId}
        ${filter}
      GROUP BY e.organization_id, e.location_id, e.item_id
    ),
    available_lots AS (
      SELECT
        b.organization_id,
        b.location_id,
        b.item_id,
        ROUND(SUM(CASE WHEN b.quantity > 0 THEN b.quantity ELSE 0 END), 4) AS positive_qty,
        ROUND(SUM(CASE WHEN b.quantity < 0 THEN ABS(b.quantity) ELSE 0 END), 4) AS debt_qty
      FROM inventory.inventory_lot_balances b
      WHERE b.organization_id = ${orgId}
        ${storedFilter}
        AND b.disposition = 'available'
      GROUP BY b.organization_id, b.location_id, b.item_id
    ),
    changed AS (
      INSERT INTO inventory.inventory_item_balances (
        organization_id,
        location_id,
        item_id,
        on_hand_qty,
        demand_qty,
        expected_qty,
        available_to_promise,
        updated_at
      )
      SELECT
        e.organization_id,
        e.location_id,
        e.item_id,
        e.on_hand_qty,
        e.demand_qty,
        e.expected_qty,
        GREATEST(
          0,
          COALESCE(a.positive_qty, 0)
            - COALESCE(a.debt_qty, 0)
            + e.expected_qty
        ) - e.demand_qty,
        NOW()
      FROM event_totals e
      LEFT JOIN available_lots a
        ON a.organization_id = e.organization_id
       AND a.location_id = e.location_id
       AND a.item_id = e.item_id
      ON CONFLICT (organization_id, location_id, item_id)
      DO UPDATE SET
        on_hand_qty = EXCLUDED.on_hand_qty,
        demand_qty = EXCLUDED.demand_qty,
        expected_qty = EXCLUDED.expected_qty,
        available_to_promise = EXCLUDED.available_to_promise,
        updated_at = NOW()
      WHERE ROUND(inventory.inventory_item_balances.on_hand_qty::numeric, 4)
          IS DISTINCT FROM EXCLUDED.on_hand_qty
         OR ROUND(inventory.inventory_item_balances.demand_qty::numeric, 4)
          IS DISTINCT FROM EXCLUDED.demand_qty
         OR ROUND(inventory.inventory_item_balances.expected_qty::numeric, 4)
          IS DISTINCT FROM EXCLUDED.expected_qty
         OR ROUND(inventory.inventory_item_balances.available_to_promise::numeric, 4)
          IS DISTINCT FROM ROUND(EXCLUDED.available_to_promise::numeric, 4)
      RETURNING 1
    )
    SELECT COUNT(*)::int AS count
    FROM changed
  `);

  const zeroed = await tx.execute(sql`
    WITH event_totals AS (
      SELECT
        e.organization_id,
        e.location_id,
        e.item_id
      FROM inventory.inventory_events e
      WHERE e.organization_id = ${orgId}
        ${filter}
      GROUP BY e.organization_id, e.location_id, e.item_id
    ),
    changed AS (
      UPDATE inventory.inventory_item_balances b
      SET
        on_hand_qty = 0,
        demand_qty = 0,
        expected_qty = 0,
        available_to_promise = 0,
        updated_at = NOW()
      WHERE b.organization_id = ${orgId}
        ${storedFilter}
        AND (
          ROUND(b.on_hand_qty::numeric, 4) <> 0
          OR ROUND(b.demand_qty::numeric, 4) <> 0
          OR ROUND(b.expected_qty::numeric, 4) <> 0
          OR ROUND(b.available_to_promise::numeric, 4) <> 0
        )
        AND NOT EXISTS (
          SELECT 1
          FROM event_totals e
          WHERE e.organization_id = b.organization_id
            AND e.location_id = b.location_id
            AND e.item_id = b.item_id
        )
      RETURNING 1
    )
    SELECT COUNT(*)::int AS count
    FROM changed
  `);

  return countRows(upserted) + countRows(zeroed);
}

async function repairLegacyLotRowsInTx(
  tx: Tx,
  orgId: string,
  itemIds?: string[]
) {
  const filter = itemScope(itemIds);
  const updated = await tx.execute(sql`
    WITH lot_totals AS (
      SELECT
        lot_id,
        ROUND(SUM(quantity), 4) AS quantity
      FROM inventory.inventory_lot_balances
      WHERE organization_id = ${orgId}
        ${filter}
      GROUP BY lot_id
    ),
    scoped_lots AS (
      SELECT l.id
      FROM inventory.lots l
      WHERE l.organization_id = ${orgId}
        ${filter}
    ),
    changed AS (
      UPDATE inventory.lots l
      SET
        quantity = COALESCE(t.quantity, 0),
        updated_at = NOW()
      FROM scoped_lots s
      LEFT JOIN lot_totals t ON t.lot_id = s.id
      WHERE l.id = s.id
        AND ROUND(l.quantity::numeric, 4)
          IS DISTINCT FROM ROUND(COALESCE(t.quantity, 0)::numeric, 4)
      RETURNING 1
    )
    SELECT COUNT(*)::int AS count
    FROM changed
  `);

  return countRows(updated);
}

export async function repairInventoryStockProjectionsForOrg(
  orgId: string,
  options?: {
    apply?: boolean;
    itemIds?: string[];
  }
): Promise<InventoryProjectionRepairResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);

    const itemIds = options?.itemIds && options.itemIds.length > 0
      ? [...new Set(options.itemIds)].sort()
      : undefined;
    const mode: ProjectionRepairMode = options?.apply ? "apply" : "dry-run";
    const before = await diffProjections(tx, orgId, itemIds);
    const beforeSummary = summarizeProjectionDiff(before);

    const repaired: InventoryProjectionRepairSummary = {
      itemRows: 0,
      lotRows: 0,
      legacyLotRows: 0,
      unrepairedDemandDeltas: beforeSummary.demandDeltas,
      unrepairedExpectedDeltas: beforeSummary.expectedDeltas,
    };

    if (mode === "apply") {
      await lockRepairScopeInTx(tx, orgId, itemIds);

      repaired.lotRows = await repairLotProjectionRowsInTx(tx, orgId, itemIds);
      repaired.itemRows = await repairItemProjectionRowsInTx(tx, orgId, itemIds);
      repaired.legacyLotRows = await repairLegacyLotRowsInTx(tx, orgId, itemIds);
    }

    const after = await diffProjections(tx, orgId, itemIds);
    const afterSummary = summarizeProjectionDiff(after);

    return {
      orgId,
      mode,
      before,
      beforeSummary,
      after,
      afterSummary,
      repaired,
    };
  });
}
