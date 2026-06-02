import { Pool, type PoolClient } from "pg";
import { loadWorktreeEnv } from "./load-worktree-env";

loadWorktreeEnv();

const INTERNAL_UNTRACKED_LOT_NUMBER = "INTERNAL-UNTRACKED";

type ItemRow = {
  item_id: string;
  item_name: string;
  lot_count: string;
  lot_qty: string;
};

function hasFlag(name: string) {
  return process.argv.includes(name);
}

function optionValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function usage() {
  console.error(
    "Usage: tsx scripts/consolidate-untracked-internal-lots.ts --org-id <org-id> [--item-id <id>] [--apply]"
  );
}

async function getOrCreateCanonicalLot(
  client: PoolClient,
  organizationId: string,
  itemId: string
) {
  const result = await client.query<{ id: string }>(
    `
      INSERT INTO inventory.lots (
        organization_id,
        item_id,
        lot_number,
        quantity,
        received_at,
        updated_at
      )
      VALUES ($1, $2, $3, 0, now(), now())
      ON CONFLICT (organization_id, item_id, lot_number)
      DO UPDATE SET updated_at = inventory.lots.updated_at
      RETURNING id
    `,
    [organizationId, itemId, INTERNAL_UNTRACKED_LOT_NUMBER]
  );

  const id = result.rows[0]?.id;
  if (!id) throw new Error(`Failed to create canonical lot for item ${itemId}.`);
  return id;
}

async function findCandidates(
  client: PoolClient,
  organizationId: string,
  itemId?: string
) {
  const result = await client.query<ItemRow>(
    `
      SELECT i.id AS item_id,
             i.name AS item_name,
             COUNT(l.id)::text AS lot_count,
             COALESCE(SUM(l.quantity), 0)::text AS lot_qty
      FROM inventory.items i
      INNER JOIN inventory.item_families f
        ON f.id = i.family_id
      LEFT JOIN inventory.lots l
        ON l.organization_id = i.organization_id
       AND l.item_id = i.id
      WHERE i.organization_id = $1
        AND f.lot_tracking_mode = 'untracked'
        AND ($2::uuid IS NULL OR i.id = $2::uuid)
      GROUP BY i.id, i.name
      HAVING COUNT(l.id) <> 1
          OR BOOL_OR(l.lot_number <> $3)
      ORDER BY i.name
    `,
    [organizationId, itemId ?? null, INTERNAL_UNTRACKED_LOT_NUMBER]
  );

  return result.rows;
}

async function assertNoBlockingState(
  client: PoolClient,
  organizationId: string,
  itemId: string,
  oldLotIds: string[]
) {
  const blockers = await client.query<{ reason: string; count: string }>(
    `
      SELECT 'non_available_balance' AS reason, COUNT(*)::text AS count
      FROM inventory.inventory_lot_balances
      WHERE organization_id = $1
        AND item_id = $2
        AND lot_id = ANY($3::uuid[])
        AND disposition <> 'available'
        AND quantity <> 0
      UNION ALL
      SELECT 'draft_stocktake_lot', COUNT(*)::text
      FROM inventory.stocktake_lot_items sli
      INNER JOIN inventory.stocktake_items si
        ON si.id = sli.stocktake_item_id
      INNER JOIN inventory.stocktakes s
        ON s.id = si.stocktake_id
      WHERE s.organization_id = $1
        AND si.item_id = $2
        AND sli.lot_id = ANY($3::uuid[])
        AND s.status = 'draft'
    `,
    [organizationId, itemId, oldLotIds]
  );
  const active = blockers.rows.filter((row) => Number(row.count) > 0);
  if (active.length > 0) {
    throw new Error(
      `Cannot consolidate item ${itemId}; blockers: ${active
        .map((row) => `${row.reason}=${row.count}`)
        .join(", ")}`
    );
  }
}

async function consolidateItem(
  client: PoolClient,
  organizationId: string,
  itemId: string
) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT id FROM inventory.items WHERE id = $1 FOR UPDATE", [
      itemId,
    ]);
    const canonicalLotId = await getOrCreateCanonicalLot(
      client,
      organizationId,
      itemId
    );
    const oldLots = await client.query<{ id: string }>(
      `
        SELECT id
        FROM inventory.lots
        WHERE organization_id = $1
          AND item_id = $2
          AND id <> $3
        FOR UPDATE
      `,
      [organizationId, itemId, canonicalLotId]
    );
    const oldLotIds = oldLots.rows.map((row) => row.id);
    if (oldLotIds.length === 0) {
      await client.query("COMMIT");
      return { oldLotCount: 0, eventCount: 0, deletedLotCount: 0 };
    }

    await assertNoBlockingState(client, organizationId, itemId, oldLotIds);

    const events = await client.query(
      `
        UPDATE inventory.inventory_events
        SET lot_id = $3,
            metadata = jsonb_set(
              COALESCE(metadata, '{}'::jsonb) - 'lotNumber',
              '{internalUntrackedLot}',
              'true'::jsonb,
              true
            )
        WHERE organization_id = $1
          AND item_id = $2
          AND lot_id = ANY($4::uuid[])
      `,
      [organizationId, itemId, canonicalLotId, oldLotIds]
    );

    await client.query(
      `
        UPDATE inventory.quality_disposition_events
        SET lot_id = $3
        WHERE organization_id = $1
          AND item_id = $2
          AND lot_id = ANY($4::uuid[])
      `,
      [organizationId, itemId, canonicalLotId, oldLotIds]
    );
    await client.query(
      `
        UPDATE manufacturing.manufacturing_order_batches b
        SET lot_id = $3
        FROM manufacturing.manufacturing_orders mo
        WHERE mo.id = b.manufacturing_order_id
          AND mo.organization_id = $1
          AND mo.product_id = $2
          AND b.lot_id = ANY($4::uuid[])
      `,
      [organizationId, itemId, canonicalLotId, oldLotIds]
    );
    await client.query(
      `
        UPDATE manufacturing.manufacturing_pick_allocations p
        SET lot_id = $3
        FROM manufacturing.manufacturing_order_ingredients i
        INNER JOIN manufacturing.manufacturing_orders mo
          ON mo.id = i.manufacturing_order_id
        WHERE p.manufacturing_order_ingredient_id = i.id
          AND mo.organization_id = $1
          AND i.item_id = $2
          AND p.lot_id = ANY($4::uuid[])
      `,
      [organizationId, itemId, canonicalLotId, oldLotIds]
    );
    await client.query(
      `
        UPDATE manufacturing.manufacturing_order_outputs o
        SET lot_id = $3
        FROM manufacturing.manufacturing_orders mo
        WHERE mo.id = o.manufacturing_order_id
          AND mo.organization_id = $1
          AND mo.product_id = $2
          AND o.lot_id = ANY($4::uuid[])
      `,
      [organizationId, itemId, canonicalLotId, oldLotIds]
    );
    await client.query(
      `
        UPDATE manufacturing.manufacturing_order_output_consumptions c
        SET lot_id = $3
        FROM manufacturing.manufacturing_order_ingredients i
        INNER JOIN manufacturing.manufacturing_orders mo
          ON mo.id = i.manufacturing_order_id
        WHERE c.manufacturing_order_ingredient_id = i.id
          AND mo.organization_id = $1
          AND i.item_id = $2
          AND c.lot_id = ANY($4::uuid[])
      `,
      [organizationId, itemId, canonicalLotId, oldLotIds]
    );

    await client.query(
      `
        WITH old_rows AS (
          SELECT sli.stocktake_item_id,
                 SUM(COALESCE(sli.expected_qty, 0)) AS expected_qty,
                 SUM(COALESCE(sli.counted_qty, 0)) AS counted_qty,
                 SUM(COALESCE(sli.variance_qty, 0)) AS variance_qty,
                 SUM(COALESCE(sli.applied_delta_qty, 0)) AS applied_delta_qty,
                 MIN(sli.received_at) AS received_at,
                 MIN(sli.sort_order) AS sort_order
          FROM inventory.stocktake_lot_items sli
          INNER JOIN inventory.stocktake_items si
            ON si.id = sli.stocktake_item_id
          INNER JOIN inventory.stocktakes s
            ON s.id = si.stocktake_id
          WHERE s.organization_id = $1
            AND si.item_id = $2
            AND sli.lot_id = ANY($4::uuid[])
          GROUP BY sli.stocktake_item_id
        ),
        deleted AS (
          DELETE FROM inventory.stocktake_lot_items sli
          USING inventory.stocktake_items si, inventory.stocktakes s
          WHERE si.id = sli.stocktake_item_id
            AND s.id = si.stocktake_id
            AND s.organization_id = $1
            AND si.item_id = $2
            AND sli.lot_id = ANY($4::uuid[])
          RETURNING sli.id
        )
        INSERT INTO inventory.stocktake_lot_items (
          stocktake_item_id,
          lot_id,
          lot_number,
          expected_qty,
          counted_qty,
          variance_qty,
          applied_delta_qty,
          received_at,
          sort_order
        )
        SELECT stocktake_item_id,
               $3,
               $5,
               expected_qty,
               counted_qty,
               variance_qty,
               applied_delta_qty,
               received_at,
               sort_order
        FROM old_rows
        ON CONFLICT (stocktake_item_id, lot_id)
        DO UPDATE SET
          expected_qty = stocktake_lot_items.expected_qty + EXCLUDED.expected_qty,
          counted_qty = COALESCE(stocktake_lot_items.counted_qty, 0) + EXCLUDED.counted_qty,
          variance_qty = COALESCE(stocktake_lot_items.variance_qty, 0) + EXCLUDED.variance_qty,
          applied_delta_qty = COALESCE(stocktake_lot_items.applied_delta_qty, 0) + EXCLUDED.applied_delta_qty,
          updated_at = now()
      `,
      [organizationId, itemId, canonicalLotId, oldLotIds, INTERNAL_UNTRACKED_LOT_NUMBER]
    );

    await client.query(
      `
        WITH source_balances AS (
          SELECT organization_id,
                 location_id,
                 item_id,
                 disposition,
                 SUM(quantity) AS quantity,
                 CASE
                   WHEN SUM(GREATEST(quantity, 0)) > 0
                     THEN ROUND(
                       SUM(GREATEST(quantity, 0) * COALESCE(unit_cost, 0))
                       / SUM(GREATEST(quantity, 0)),
                       6
                     )
                   ELSE MAX(unit_cost)
                 END AS unit_cost,
                 MIN(received_at) AS received_at,
                 (ARRAY_AGG(origin_event_id ORDER BY received_at, origin_event_id))[1] AS origin_event_id
          FROM inventory.inventory_lot_balances
          WHERE organization_id = $1
            AND item_id = $2
            -- Only the superseded lots are merged into the canonical lot. The
            -- canonical lot's own balance must stay out of this set: the DELETE
            -- and ON CONFLICT DO UPDATE below would otherwise hit the same row
            -- twice in one statement (unsupported by Postgres) and double-count
            -- the canonical stock. ON CONFLICT folds the old totals into the
            -- surviving canonical row instead.
            AND lot_id = ANY($4::uuid[])
          GROUP BY organization_id, location_id, item_id, disposition
        ),
        deleted AS (
          DELETE FROM inventory.inventory_lot_balances
          WHERE organization_id = $1
            AND item_id = $2
            AND lot_id = ANY($4::uuid[])
          RETURNING 1
        )
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
          still_active
        )
        SELECT organization_id,
               location_id,
               $3,
               item_id,
               disposition,
               quantity,
               unit_cost,
               COALESCE(received_at, now()),
               origin_event_id,
               quantity > 0
        FROM source_balances
        WHERE quantity <> 0
           OR origin_event_id IS NOT NULL
        ON CONFLICT (organization_id, item_id, location_id, lot_id, disposition)
        DO UPDATE SET
          quantity = inventory.inventory_lot_balances.quantity + EXCLUDED.quantity,
          unit_cost = CASE
            WHEN (
              GREATEST(inventory.inventory_lot_balances.quantity, 0)
              + GREATEST(EXCLUDED.quantity, 0)
            ) > 0
              THEN ROUND(
                (
                  GREATEST(inventory.inventory_lot_balances.quantity, 0)
                  * COALESCE(inventory.inventory_lot_balances.unit_cost, 0)
                  + GREATEST(EXCLUDED.quantity, 0) * COALESCE(EXCLUDED.unit_cost, 0)
                )
                / (
                  GREATEST(inventory.inventory_lot_balances.quantity, 0)
                  + GREATEST(EXCLUDED.quantity, 0)
                ),
                6
              )
            ELSE COALESCE(inventory.inventory_lot_balances.unit_cost, EXCLUDED.unit_cost)
          END,
          received_at = LEAST(
            inventory.inventory_lot_balances.received_at,
            EXCLUDED.received_at
          ),
          origin_event_id = COALESCE(
            inventory.inventory_lot_balances.origin_event_id,
            EXCLUDED.origin_event_id
          ),
          still_active = (
            inventory.inventory_lot_balances.quantity + EXCLUDED.quantity
          ) > 0
      `,
      [organizationId, itemId, canonicalLotId, oldLotIds]
    );

    await client.query(
      `
        UPDATE inventory.lots
        SET quantity = COALESCE((
              SELECT SUM(quantity)
              FROM inventory.inventory_lot_balances
              WHERE organization_id = $1
                AND item_id = $2
                AND lot_id = $3
            ), 0),
            updated_at = now()
        WHERE id = $3
      `,
      [organizationId, itemId, canonicalLotId]
    );

    const deleted = await client.query(
      `
        DELETE FROM inventory.lots
        WHERE organization_id = $1
          AND item_id = $2
          AND id = ANY($3::uuid[])
      `,
      [organizationId, itemId, oldLotIds]
    );

    await client.query("COMMIT");
    return {
      oldLotCount: oldLotIds.length,
      eventCount: events.rowCount ?? 0,
      deletedLotCount: deleted.rowCount ?? 0,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  const organizationId = optionValue("--org-id");
  const itemId = optionValue("--item-id");
  const apply = hasFlag("--apply");

  if (!organizationId) {
    usage();
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const candidates = await findCandidates(client, organizationId, itemId);
    console.log(
      `${apply ? "Applying" : "Dry run"} untracked lot consolidation for org ${organizationId}`
    );
    console.log(`Candidates: ${candidates.length}`);
    for (const candidate of candidates) {
      console.log(
        `- ${candidate.item_name} (${candidate.item_id}): ${candidate.lot_count} lots, qty ${candidate.lot_qty}`
      );
    }

    if (!apply) {
      console.log("Dry run only. Re-run with --apply to consolidate.");
      return;
    }

    let oldLots = 0;
    let events = 0;
    let deletedLots = 0;
    for (const candidate of candidates) {
      const result = await consolidateItem(client, organizationId, candidate.item_id);
      oldLots += result.oldLotCount;
      events += result.eventCount;
      deletedLots += result.deletedLotCount;
    }

    console.log("Applied consolidation.");
    console.log(`- old lots scanned: ${oldLots}`);
    console.log(`- events repointed: ${events}`);
    console.log(`- old lots deleted: ${deletedLots}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
