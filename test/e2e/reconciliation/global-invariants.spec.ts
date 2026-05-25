import { and, eq, sql } from "drizzle-orm";
import {
  inventoryItemBalances,
  lots,
} from "@/lib/db/schema";
import { test, expect } from "../fixtures";
import { getOrgId } from "../../helpers/api";

// -----------------------------------------------------------------------
// 5 global invariants derived from the so-mo-linkage scenario pack
// (test/scenarios/so-mo-linkage/scenarios.json). Each runs a single
// SELECT against the accumulated test-org state and asserts a contract
// that must hold across ALL rows in the org. Pure read-only — these
// tests can run in parallel and after any other test without side
// effects on shared state.
//
// Use these as the canonical regression net for state-machine drift:
// if any of them starts failing, a recent change to the inventory
// kernel, manufacturing DAL, or sales DAL has broken a domain
// invariant that data integrity depends on.
// -----------------------------------------------------------------------

test.describe("global inventory and manufacturing invariants", () => {
  const orgId = getOrgId();

  test("invariant: SO↔MO claim uniqueness — no salesOrderLineId carries more than one active MO", async ({
    db,
  }) => {
    // BR-1 contract: at most one non-deleted manufacturingOrder per
    // sales_order_line_id across the entire org.
    const violations = await db.execute(sql`
      SELECT sales_order_line_id, COUNT(*) AS claim_count
      FROM manufacturing.manufacturing_orders
      WHERE organization_id = ${orgId}
        AND sales_order_line_id IS NOT NULL
        AND deleted_at IS NULL
      GROUP BY sales_order_line_id
      HAVING COUNT(*) > 1
    `);
    expect(
      violations.rows,
      `BR-1 violated: salesOrderLineIds with more than one active MO: ${JSON.stringify(violations.rows)}`
    ).toHaveLength(0);
  });

  test("invariant: lot quantity conservation — every lot has non-negative quantity and item balances reconcile with lot sums", async ({
    db,
  }) => {
    // Per-lot: ordinary lots must never be negative. Intentional
    // negative-stock overrides create NEG-* synthetic lots with negative
    // quantity; those are valid so the conservation check below covers them.
    const negativeLots = await db
      .select({ id: lots.id, itemId: lots.itemId, quantity: lots.quantity })
      .from(lots)
      .where(
        and(
          eq(lots.organizationId, orgId),
          sql`${lots.lotNumber} NOT LIKE 'NEG-%'`,
          sql`${lots.quantity}::numeric < 0`
        )
      );
    expect(
      negativeLots,
      `Found ${negativeLots.length} lot rows with negative quantity (impossible state): ${JSON.stringify(negativeLots.slice(0, 5))}`
    ).toHaveLength(0);

    // Aggregate: for every item that has lots, SUM(lots.quantity) equals
    // SUM(inventory_item_balances.on_hand_qty) across locations. A drift
    // means the projection ledger has lost sync with raw lot rows.
    const mismatches = await db.execute(sql`
      WITH lot_sums AS (
        SELECT item_id, SUM(quantity)::numeric AS lot_qty
        FROM inventory.lots
        WHERE organization_id = ${orgId}
        GROUP BY item_id
      ),
      balance_sums AS (
        SELECT item_id, SUM(on_hand_qty)::numeric AS balance_qty
        FROM inventory.inventory_item_balances
        WHERE organization_id = ${orgId}
        GROUP BY item_id
      )
      SELECT
        COALESCE(l.item_id, b.item_id) AS item_id,
        COALESCE(l.lot_qty, 0) AS lot_qty,
        COALESCE(b.balance_qty, 0) AS balance_qty
      FROM lot_sums l
      FULL OUTER JOIN balance_sums b ON l.item_id = b.item_id
      WHERE ROUND(COALESCE(l.lot_qty, 0), 4) <> ROUND(COALESCE(b.balance_qty, 0), 4)
    `);
    expect(
      mismatches.rows,
      `Lot vs balance drift on ${mismatches.rows.length} items: ${JSON.stringify(mismatches.rows.slice(0, 5))}`
    ).toHaveLength(0);
  });

  test("invariant: expected_qty sanity — no negative projections and zero-supply items always have expected_qty = 0", async ({
    db,
  }) => {
    // Part 1: expected_qty is inbound supply; it must never be negative
    // for any item in the org.
    const negative = await db
      .select({
        itemId: inventoryItemBalances.itemId,
        expectedQty: inventoryItemBalances.expectedQty,
      })
      .from(inventoryItemBalances)
      .where(
        and(
          eq(inventoryItemBalances.organizationId, orgId),
          sql`${inventoryItemBalances.expectedQty}::numeric < 0`
        )
      );
    expect(
      negative,
      `Found ${negative.length} item-balance rows with negative expectedQty: ${JSON.stringify(negative.slice(0, 5))}`
    ).toHaveLength(0);

    // Part 2: if there are no inbound MOs or POs for an item, its
    // projected expectedQty must be 0. A non-zero expectedQty with no
    // supplier is a sign that the expected projection missed a status
    // transition somewhere. MO contribution = non-deleted +
    // non-completed. PO contribution = active ordered/partial lines with
    // remaining stock quantity.
    const orphans = await db.execute(sql`
      WITH balance_expected AS (
        SELECT item_id, SUM(expected_qty)::numeric AS total
        FROM inventory.inventory_item_balances
        WHERE organization_id = ${orgId}
        GROUP BY item_id
        HAVING SUM(expected_qty)::numeric > 0
      ),
      mo_supply AS (
        SELECT DISTINCT product_id AS item_id
        FROM manufacturing.manufacturing_orders
        WHERE organization_id = ${orgId}
          AND deleted_at IS NULL
          AND completed_at IS NULL
      ),
      po_supply AS (
        SELECT DISTINCT pol.item_id
        FROM purchasing.purchase_order_lines pol
        JOIN purchasing.purchase_orders po ON po.id = pol.purchase_order_id
        WHERE po.organization_id = ${orgId}
          AND po.deleted_at IS NULL
          AND po.status IN ('ordered', 'partial')
          AND ROUND(
            (pol.stock_quantity_ordered - pol.stock_quantity_received)::numeric,
            4
          ) > 0
      )
      SELECT be.item_id, ROUND(be.total, 4) AS expected_qty
      FROM balance_expected be
      LEFT JOIN mo_supply mo ON be.item_id = mo.item_id
      LEFT JOIN po_supply po ON be.item_id = po.item_id
      WHERE mo.item_id IS NULL AND po.item_id IS NULL
    `);
    expect(
      orphans.rows,
      `Items have expected_qty > 0 with no MO or PO supplier (projection drift): ${JSON.stringify(orphans.rows.slice(0, 5))}`
    ).toHaveLength(0);
  });

  test("invariant: pick allocation totals — no ingredient has pick allocations exceeding its planned consumption", async ({
    db,
  }) => {
    // For every manufacturing_order_ingredient row, the sum of its
    // pick_allocations.quantityUsed must be <= planned_quantity (plus a
    // 4dp tolerance). An over-allocation means picks consumed more
    // stock than planning had requested.
    const overAllocated = await db.execute(sql`
      SELECT
        ingredient.id AS ingredient_id,
        ROUND(ingredient.planned_quantity::numeric, 4) AS planned,
        ROUND(COALESCE(SUM(alloc.quantity_used), 0)::numeric, 4) AS allocated
      FROM manufacturing.manufacturing_order_ingredients ingredient
      JOIN manufacturing.manufacturing_orders mo ON mo.id = ingredient.manufacturing_order_id
      LEFT JOIN manufacturing.manufacturing_pick_allocations alloc
        ON alloc.manufacturing_order_ingredient_id = ingredient.id
      WHERE mo.organization_id = ${orgId}
        AND mo.deleted_at IS NULL
      GROUP BY ingredient.id, ingredient.planned_quantity
      HAVING ROUND(COALESCE(SUM(alloc.quantity_used), 0)::numeric, 4)
           > ROUND(ingredient.planned_quantity::numeric, 4) + 0.0001
    `);
    expect(
      overAllocated.rows,
      `Pick over-allocation on ${overAllocated.rows.length} ingredients: ${JSON.stringify(overAllocated.rows.slice(0, 5))}`
    ).toHaveLength(0);
  });

  test("invariant: allocation conservation — sum of active stock allocations to a sales line never exceeds its ordered quantity", async ({
    db,
  }) => {
    // For every sales_order_lines row, SUM(stock_allocations.quantity)
    // active demand of type 'sales_order_line' against this line id must
    // be <= line.quantity. Shipment lines are fulfillment slices; active
    // allocation demand belongs to the parent sales line.
    const overReserved = await db.execute(sql`
      SELECT
        line.id AS line_id,
        ROUND(line.quantity::numeric, 4) AS ordered,
        ROUND(COALESCE(SUM(alloc.quantity), 0)::numeric, 4) AS allocated
      FROM sales.sales_order_lines line
      JOIN sales.sales_orders so ON so.id = line.sales_order_id
      LEFT JOIN inventory.stock_allocations alloc
        ON alloc.demand_id = line.id
        AND alloc.demand_type = 'sales_order_line'
        AND alloc.status = 'active'
      WHERE so.organization_id = ${orgId}
        AND so.deleted_at IS NULL
      GROUP BY line.id, line.quantity
      HAVING ROUND(COALESCE(SUM(alloc.quantity), 0)::numeric, 4)
           > ROUND(line.quantity::numeric, 4) + 0.0001
    `);
    expect(
      overReserved.rows,
      `Sales-line over-allocation on ${overReserved.rows.length} lines: ${JSON.stringify(overReserved.rows.slice(0, 5))}`
    ).toHaveLength(0);
  });

  test("invariant: shipment lines do not own active stock allocations", async ({
    db,
  }) => {
    const rows = await db.execute(sql`
      SELECT id, demand_id, item_id, quantity
      FROM inventory.stock_allocations
      WHERE organization_id = ${orgId}
        AND demand_type = 'sales_shipment_line'
        AND status = 'active'
      LIMIT 5
    `);

    expect(
      rows.rows,
      `Active shipment-line stock allocations remain after migration: ${JSON.stringify(rows.rows)}`
    ).toHaveLength(0);
  });

  test("invariant: active shipment-line stock allocation inserts are rejected", async ({
    db,
  }) => {
    const [lot] = await db
      .select({ id: lots.id, itemId: lots.itemId })
      .from(lots)
      .where(eq(lots.organizationId, orgId));
    expect(lot).toBeTruthy();
    const orgLiteral = orgId.replace(/'/g, "''");
    const itemId = lot!.itemId;
    const lotId = lot!.id;

    await db.execute(sql.raw(`
      DO $$
      DECLARE
        rejected boolean := false;
      BEGIN
        BEGIN
          INSERT INTO inventory.stock_allocations (
            organization_id,
            demand_type,
            demand_id,
            item_id,
            source_type,
            source_id,
            quantity,
            status
          )
          VALUES (
            '${orgLiteral}',
            'sales_shipment_line',
            gen_random_uuid(),
            '${itemId}'::uuid,
            'inventory_lot',
            '${lotId}'::uuid,
            1,
            'active'
          );
        EXCEPTION
          WHEN check_violation THEN
            rejected := true;
        END;

        IF NOT rejected THEN
          RAISE EXCEPTION 'active sales_shipment_line allocation insert was not rejected';
        END IF;
      END $$;
    `));
  });

  test("invariant: physical lot pins reconcile to reservation projection", async ({
    db,
  }) => {
    const mismatches = await db.execute(sql`
      WITH pin_totals AS (
        SELECT
          organization_id,
          item_id,
          demand_type,
          demand_id,
          ROUND(SUM(quantity)::numeric, 4) AS pin_qty
        FROM inventory.stock_allocations
        WHERE organization_id = ${orgId}
          AND status = 'active'
          AND source_type = 'inventory_lot'
          AND demand_type IN ('sales_order_line', 'manufacturing_order_ingredient')
        GROUP BY organization_id, item_id, demand_type, demand_id
      ),
      reservation_totals AS (
        SELECT
          organization_id,
          item_id,
          reference_type AS demand_type,
          reference_id AS demand_id,
          ROUND(SUM(quantity)::numeric, 4) AS reserved_qty
        FROM inventory.inventory_reservations_summary
        WHERE organization_id = ${orgId}
        GROUP BY organization_id, item_id, reference_type, reference_id
      )
      SELECT
        pins.item_id,
        pins.demand_type,
        pins.demand_id,
        pins.pin_qty,
        COALESCE(reservations.reserved_qty, 0) AS reserved_qty
      FROM pin_totals pins
      LEFT JOIN reservation_totals reservations
        ON reservations.organization_id = pins.organization_id
       AND reservations.item_id = pins.item_id
       AND reservations.demand_type = pins.demand_type
       AND reservations.demand_id = pins.demand_id
      WHERE pins.pin_qty <> COALESCE(reservations.reserved_qty, 0)
      LIMIT 10
    `);

    expect(
      mismatches.rows,
      `Inventory-lot pins without matching reservations: ${JSON.stringify(mismatches.rows)}`
    ).toHaveLength(0);
  });
});
