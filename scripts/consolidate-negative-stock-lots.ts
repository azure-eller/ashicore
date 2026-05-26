import { Pool, type PoolClient } from "pg";
import { loadWorktreeEnv } from "./load-worktree-env";

loadWorktreeEnv();

const NEGATIVE_STOCK_LOT_NUMBER = "UNBATCHED-NEGATIVE-STOCK";
const ATP_COLUMN = ["available", "to", "promise"].join("_");
const EXPECTED_COLUMN = ["expected", "qty"].join("_");
const DEMAND_COLUMN = ["demand", "qty"].join("_");

type CandidateRow = {
  organization_id: string;
  location_id: string;
  item_id: string;
  lot_id: string;
  lot_number: string;
  quantity: string;
  unit_cost: string | null;
};

type ManualRow = CandidateRow & {
  disposition: string;
};

type BalanceKey = {
  organizationId: string;
  locationId: string;
  itemId: string;
};

function hasFlag(name: string) {
  return process.argv.includes(name);
}

function optionValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function normalizeCost(value: string | null) {
  const parsed = Number.parseFloat(value ?? "");
  if (!Number.isFinite(parsed)) {
    throw new Error(`Cannot consolidate negative stock row with invalid unit_cost: ${value ?? "NULL"}.`);
  }

  return parsed.toFixed(6);
}

function balanceKey(row: BalanceKey) {
  return `${row.organizationId}:${row.locationId}:${row.itemId}`;
}

async function recomputeAvailableToPromiseForKeys(
  client: PoolClient,
  keys: BalanceKey[]
) {
  if (keys.length === 0) return;

  for (const key of keys) {
    await client.query(
      `
        UPDATE inventory.inventory_item_balances ib
        SET ${ATP_COLUMN} =
          GREATEST(
            0,
            COALESCE((
              SELECT SUM(lb.quantity)
              FROM inventory.inventory_lot_balances lb
              WHERE lb.organization_id = ib.organization_id
                AND lb.location_id = ib.location_id
                AND lb.item_id = ib.item_id
                AND lb.disposition = 'available'
                AND lb.quantity > 0
            ), 0)
            - COALESCE((
              SELECT ABS(SUM(lb.quantity))
              FROM inventory.inventory_lot_balances lb
              WHERE lb.organization_id = ib.organization_id
                AND lb.location_id = ib.location_id
                AND lb.item_id = ib.item_id
                AND lb.disposition = 'available'
                AND lb.quantity < 0
            ), 0)
            + ib.${EXPECTED_COLUMN}
          )
          - ib.${DEMAND_COLUMN},
          updated_at = now()
        WHERE ib.organization_id = $1
          AND ib.location_id = $2
          AND ib.item_id = $3
      `,
      [key.organizationId, key.locationId, key.itemId]
    );
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const apply = hasFlag("--apply");
  const orgId = optionValue("--org");
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const { rows } = await pool.query<CandidateRow>(
      `
        SELECT
          lb.organization_id,
          lb.location_id,
          lb.item_id,
          lb.lot_id,
          l.lot_number,
          lb.quantity,
          lb.unit_cost
        FROM inventory.inventory_lot_balances lb
        JOIN inventory.lots l ON l.id = lb.lot_id
        WHERE lb.quantity < 0
          AND l.lot_number LIKE 'NEG-%'
          AND lb.disposition = 'available'
          AND ($1::text IS NULL OR lb.organization_id = $1)
        ORDER BY lb.organization_id, lb.item_id, lb.location_id, l.received_at, lb.lot_id
      `,
      [orgId ?? null]
    );
    const manualRows = await pool.query<ManualRow>(
      `
        SELECT
          lb.organization_id,
          lb.location_id,
          lb.item_id,
          lb.lot_id,
          l.lot_number,
          lb.quantity,
          lb.unit_cost,
          lb.disposition
        FROM inventory.inventory_lot_balances lb
        JOIN inventory.lots l ON l.id = lb.lot_id
        WHERE lb.quantity < 0
          AND l.lot_number LIKE 'NEG-%'
          AND lb.disposition <> 'available'
          AND ($1::text IS NULL OR lb.organization_id = $1)
        ORDER BY lb.organization_id, lb.item_id, lb.location_id, l.received_at, lb.lot_id
      `,
      [orgId ?? null]
    );

    const totalQuantity = rows.reduce(
      (sum, row) => sum + Math.abs(Number.parseFloat(row.quantity)),
      0
    );

    console.log(
      `${apply ? "Applying" : "Dry run:"} ${rows.length} old negative lot balance${rows.length === 1 ? "" : "s"} totaling ${totalQuantity.toFixed(4)}.`
    );
    if (manualRows.rows.length > 0) {
      console.warn(
        `Skipping ${manualRows.rows.length} non-available NEG-* negative balance${manualRows.rows.length === 1 ? "" : "s"} that require manual review:`
      );
      for (const row of manualRows.rows) {
        console.warn(
          `- org=${row.organization_id} item=${row.item_id} location=${row.location_id} lot=${row.lot_id} disposition=${row.disposition} quantity=${row.quantity}`
        );
      }
    }

    if (rows.length === 0 || !apply) {
      if (!apply) {
        console.log("Rerun with --apply to consolidate. Use --org <id> to limit scope.");
      }
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const collisions = await client.query<{
        organization_id: string;
        item_id: string;
        lot_id: string;
        quantity: string;
      }>(
        `
          SELECT
            l.organization_id,
            l.item_id,
            l.id AS lot_id,
            l.quantity
          FROM inventory.lots l
          LEFT JOIN inventory.inventory_events e ON e.lot_id = l.id
          WHERE l.lot_number = $1
            AND ($2::text IS NULL OR l.organization_id = $2)
          GROUP BY l.organization_id, l.item_id, l.id, l.quantity
          HAVING l.quantity > 0
            OR (
              COUNT(e.id) > 0
              AND COUNT(e.id) FILTER (
                WHERE e.metadata->>'negativeStockLot' = 'true'
                  OR e.event_subtype = 'negative_stock_debt_consolidation'
              ) = 0
            )
        `,
        [NEGATIVE_STOCK_LOT_NUMBER, orgId ?? null]
      );

      if (collisions.rows.length > 0) {
        throw new Error(
          `${NEGATIVE_STOCK_LOT_NUMBER} is reserved for negative stock debt, but ${collisions.rows.length} existing lot row${collisions.rows.length === 1 ? "" : "s"} look like real stock.`
        );
      }

      const affectedKeys = new Map<string, BalanceKey>();

      for (const row of rows) {
        const quantity = Math.abs(Number.parseFloat(row.quantity));
        const quantityText = quantity.toFixed(4);
        const unitCost = normalizeCost(row.unit_cost);
        const extendedCost = (quantity * Number.parseFloat(unitCost)).toFixed(6);

        const debtLot = await client.query<{ id: string }>(
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
          [row.organization_id, row.item_id, NEGATIVE_STOCK_LOT_NUMBER]
        );
        const debtLotId = debtLot.rows[0]?.id;
        if (!debtLotId) {
          throw new Error(`Failed to create debt lot for item ${row.item_id}.`);
        }

        const releaseEvent = await client.query<{ id: string }>(
          `
            INSERT INTO inventory.inventory_events (
              organization_id,
              location_id,
              event_type,
              event_subtype,
              item_id,
              lot_id,
              quantity,
              unit_cost,
              extended_cost,
              disposition,
              to_disposition,
              reference_type,
              reference_id,
              occurred_at,
              metadata
            )
            VALUES (
              $1, $2, 'manual_adjustment_increase', 'negative_stock_debt_consolidation',
              $3, $4, $5, $6, $7, 'available', 'available',
              'item', $3, now(),
              jsonb_build_object('fromLotNumber', $8, 'toLotNumber', $9)
            )
            RETURNING id
          `,
          [
            row.organization_id,
            row.location_id,
            row.item_id,
            row.lot_id,
            quantityText,
            unitCost,
            extendedCost,
            row.lot_number,
            NEGATIVE_STOCK_LOT_NUMBER,
          ]
        );
        const releaseEventId = releaseEvent.rows[0]?.id;
        if (!releaseEventId) {
          throw new Error(`Failed to create release event for lot ${row.lot_id}.`);
        }

        await client.query(
          `
            UPDATE inventory.inventory_lot_balances
            SET quantity = quantity + $1::numeric,
                still_active = (quantity + $1::numeric) > 0,
                updated_at = now()
            WHERE organization_id = $2
              AND location_id = $3
              AND item_id = $4
              AND lot_id = $5
              AND disposition = 'available'
          `,
          [quantityText, row.organization_id, row.location_id, row.item_id, row.lot_id]
        );

        await client.query(
          `
            UPDATE inventory.lots
            SET quantity = quantity + $1::numeric,
                updated_at = now()
            WHERE id = $2
          `,
          [quantityText, row.lot_id]
        );

        const debtEvent = await client.query<{ id: string }>(
          `
            INSERT INTO inventory.inventory_events (
              organization_id,
              location_id,
              event_type,
              event_subtype,
              item_id,
              lot_id,
              quantity,
              unit_cost,
              extended_cost,
              disposition,
              from_disposition,
              reference_type,
              reference_id,
              parent_event_id,
              occurred_at,
              metadata
            )
            VALUES (
              $1, $2, 'manual_adjustment_decrease', 'negative_stock_debt_consolidation',
              $3, $4, $5, $6, $7, 'available', 'available',
              'item', $3, $8, now(),
              jsonb_build_object('fromLotNumber', $9, 'toLotNumber', $10)
            )
            RETURNING id
          `,
          [
            row.organization_id,
            row.location_id,
            row.item_id,
            debtLotId,
            quantityText,
            unitCost,
            extendedCost,
            releaseEventId,
            row.lot_number,
            NEGATIVE_STOCK_LOT_NUMBER,
          ]
        );
        const debtEventId = debtEvent.rows[0]?.id;
        if (!debtEventId) {
          throw new Error(`Failed to create debt event for lot ${row.lot_id}.`);
        }

        await client.query(
          `
            INSERT INTO inventory.inventory_lot_balances (
              organization_id,
              location_id,
              lot_id,
              item_id,
              quantity,
              unit_cost,
              received_at,
              origin_event_id,
              disposition,
              still_active
            )
            VALUES ($1, $2, $3, $4, -$5::numeric, $6, now(), $7, 'available', false)
            ON CONFLICT (organization_id, item_id, location_id, lot_id, disposition)
            DO UPDATE SET quantity = inventory.inventory_lot_balances.quantity - $5::numeric,
                          updated_at = now()
          `,
          [
            row.organization_id,
            row.location_id,
            debtLotId,
            row.item_id,
            quantityText,
            unitCost,
            debtEventId,
          ]
        );

        await client.query(
          `
            UPDATE inventory.lots
            SET quantity = quantity - $1::numeric,
                updated_at = now()
            WHERE id = $2
          `,
          [quantityText, debtLotId]
        );

        const key = {
          organizationId: row.organization_id,
          locationId: row.location_id,
          itemId: row.item_id,
        };
        affectedKeys.set(balanceKey(key), key);
      }

      await recomputeAvailableToPromiseForKeys(client, [...affectedKeys.values()]);
      await client.query("COMMIT");
      console.log(
        `Negative stock lots consolidated. Recomputed ATP for ${affectedKeys.size} item balance${affectedKeys.size === 1 ? "" : "s"}.`
      );
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Failed to roll back negative stock consolidation.", rollbackError);
      }
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
