import { Client } from "pg";
import { loadWorktreeEnv } from "./load-worktree-env";

type OrderRow = {
  id: string;
  organization_id: string;
  order_number: string;
  customer_id: string;
  customer_project_id: string | null;
  customer_name: string;
  status: string;
  order_date: string;
  notes: string | null;
  ship_line1: string | null;
  ship_line2: string | null;
  ship_city: string | null;
  ship_region: string | null;
  ship_postcode: string | null;
  ship_country: string | null;
  billing_line1: string | null;
  billing_line2: string | null;
  billing_city: string | null;
  billing_region: string | null;
  billing_postcode: string | null;
  billing_country: string | null;
};

type ShipmentRow = {
  id: string;
  sequence: number;
  scheduled_date: string | null;
  delivery_date: string | null;
  fulfillment_type: string;
  notes: string | null;
  customer_freight_charge_amount: string | null;
};

type ShipmentLineRow = {
  id: string;
  sales_order_line_id: string;
  item_id: string;
  item_name: string;
  item_sku: string | null;
  unit_name: string;
  quantity: string;
  unit_price: string;
  tax_rate_id: string | null;
  tax_rate_name: string | null;
  tax_rate_percent: string;
  suggested_unit_price: string | null;
  pricing_source_type: string | null;
  pricing_schedule_name: string | null;
  pricing_break_label: string | null;
  is_price_overridden: boolean;
  allocation_managed_at: Date | null;
  allocation_managed_by: string | null;
  sort_order: number;
};

const apply = process.argv.includes("--apply");

function toNumber(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(quantity: string, unitPrice: string) {
  return (toNumber(quantity) * toNumber(unitPrice)).toFixed(2);
}

function taxAmount(subtotal: string, ratePercent: string | null | undefined) {
  return (toNumber(subtotal) * (toNumber(ratePercent) / 100)).toFixed(2);
}

function quantity(value: string | number) {
  return toNumber(value).toFixed(4);
}

function nextOrderNumber(base: string, sequence: number) {
  const suffix = `-${sequence}`;
  return `${base.slice(0, 32 - suffix.length)}${suffix}`;
}

async function getDefaultLocationId(client: Client, organizationId: string) {
  const result = await client.query<{ id: string }>(
    `
      SELECT id
      FROM inventory.locations
      WHERE organization_id = $1
        AND is_default = true
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [organizationId]
  );
  if (!result.rows[0]) {
    throw new Error(`No default inventory location for organization ${organizationId}.`);
  }
  return result.rows[0].id;
}

async function insertReferenceEvent(
  client: Client,
  params: {
    organizationId: string;
    locationId: string;
    itemId: string;
    eventType: "demand_increase" | "demand_release" | "reservation_increase" | "reservation_release";
    quantity: string;
    referenceId: string;
    idempotencyKey: string;
  }
) {
  await client.query(
    `
      INSERT INTO inventory.inventory_events (
        organization_id,
        location_id,
        event_type,
        event_subtype,
        item_id,
        quantity,
        reference_type,
        reference_id,
        idempotency_key,
        occurred_at,
        metadata
      )
      VALUES ($1, $2, $3, 'split_multi_shipment_sales_orders', $4, $5, 'sales_order_line', $6, $7, now(), '{}'::jsonb)
      ON CONFLICT (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
    `,
    [
      params.organizationId,
      params.locationId,
      params.eventType,
      params.itemId,
      params.quantity,
      params.referenceId,
      params.idempotencyKey,
    ]
  );
}

async function adjustReferenceSummary(
  client: Client,
  params: {
    table: "inventory.inventory_demands_summary" | "inventory.inventory_reservations_summary";
    organizationId: string;
    locationId: string;
    itemId: string;
    referenceId: string;
    delta: number;
  }
) {
  if (params.delta > 0) {
    await client.query(
      `
        INSERT INTO ${params.table} (
          organization_id,
          location_id,
          item_id,
          reference_type,
          reference_id,
          quantity,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, 'sales_order_line', $4, $5, now(), now())
        ON CONFLICT (organization_id, location_id, item_id, reference_type, reference_id)
        DO UPDATE SET
          quantity = ${params.table}.quantity + EXCLUDED.quantity,
          updated_at = now()
      `,
      [
        params.organizationId,
        params.locationId,
        params.itemId,
        params.referenceId,
        quantity(params.delta),
      ]
    );
  } else if (params.delta < 0) {
    await client.query(
      `
        UPDATE ${params.table}
        SET quantity = quantity + $5::numeric,
            updated_at = now()
        WHERE organization_id = $1
          AND location_id = $2
          AND item_id = $3
          AND reference_type = 'sales_order_line'
          AND reference_id = $4
      `,
      [
        params.organizationId,
        params.locationId,
        params.itemId,
        params.referenceId,
        quantity(params.delta),
      ]
    );
    await client.query(
      `
        DELETE FROM ${params.table}
        WHERE organization_id = $1
          AND location_id = $2
          AND item_id = $3
          AND reference_type = 'sales_order_line'
          AND reference_id = $4
          AND quantity <= 0
      `,
      [params.organizationId, params.locationId, params.itemId, params.referenceId]
    );
  }
}

async function moveLineProjection(
  client: Client,
  params: {
    organizationId: string;
    locationId: string;
    oldLineId: string;
    newLineId: string;
    itemId: string;
    quantity: string;
  }
) {
  const qty = quantity(params.quantity);
  for (const eventType of ["demand_release", "reservation_release"] as const) {
    await insertReferenceEvent(client, {
      organizationId: params.organizationId,
      locationId: params.locationId,
      itemId: params.itemId,
      eventType,
      quantity: qty,
      referenceId: params.oldLineId,
      idempotencyKey: `split-multi-shipment:${params.oldLineId}:${params.newLineId}:${eventType}`,
    });
  }
  for (const eventType of ["demand_increase", "reservation_increase"] as const) {
    await insertReferenceEvent(client, {
      organizationId: params.organizationId,
      locationId: params.locationId,
      itemId: params.itemId,
      eventType,
      quantity: qty,
      referenceId: params.newLineId,
      idempotencyKey: `split-multi-shipment:${params.oldLineId}:${params.newLineId}:${eventType}`,
    });
  }
  for (const table of [
    "inventory.inventory_demands_summary",
    "inventory.inventory_reservations_summary",
  ] as const) {
    await adjustReferenceSummary(client, {
      table,
      organizationId: params.organizationId,
      locationId: params.locationId,
      itemId: params.itemId,
      referenceId: params.oldLineId,
      delta: -toNumber(qty),
    });
    await adjustReferenceSummary(client, {
      table,
      organizationId: params.organizationId,
      locationId: params.locationId,
      itemId: params.itemId,
      referenceId: params.newLineId,
      delta: toNumber(qty),
    });
  }
}

async function main() {
  loadWorktreeEnv();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required.");

  const client = new Client({ connectionString });
  await client.connect();
  await client.query("BEGIN");

  try {
    const candidates = await client.query<{
      id: string;
      order_number: string;
      planned_count: number;
      shipped_count: number;
    }>(
      `
        SELECT
          so.id,
          so.order_number,
          COUNT(*) FILTER (WHERE ss.status = 'planned')::int AS planned_count,
          COUNT(*) FILTER (WHERE ss.status = 'shipped')::int AS shipped_count
        FROM sales.sales_orders so
        JOIN sales.sales_shipments ss ON ss.sales_order_id = so.id
        WHERE so.deleted_at IS NULL
          AND so.status = 'open'
        GROUP BY so.id, so.order_number
        HAVING COUNT(*) FILTER (WHERE ss.status = 'planned') > 1
        ORDER BY so.order_number
      `
    );

    console.log(
      `${apply ? "Applying" : "Dry run:"} ${candidates.rows.length} open sales orders have multiple planned shipments.`
    );
    if (candidates.rows.length === 0) {
      await client.query("ROLLBACK");
      return;
    }

    const orderIds = candidates.rows.map((row) => row.id);

    await client.query(
      `
        CREATE TEMP TABLE split_allocation_demands_to_cancel (
          demand_type text NOT NULL,
          demand_id uuid NOT NULL
        ) ON COMMIT DROP
      `
    );
    await client.query(
      `
        CREATE TEMP TABLE split_moved_line_quantities (
          sales_order_line_id uuid PRIMARY KEY,
          quantity numeric NOT NULL
        ) ON COMMIT DROP
      `
    );
    await client.query(
      `
        INSERT INTO split_allocation_demands_to_cancel (demand_type, demand_id)
        SELECT 'sales_order_line', sol.id
        FROM sales.sales_order_lines sol
        WHERE sol.sales_order_id = ANY($1::uuid[])
        UNION
        SELECT 'sales_shipment_line', ssl.id
        FROM sales.sales_shipment_lines ssl
        JOIN sales.sales_shipments ss ON ss.id = ssl.sales_shipment_id
        WHERE ss.sales_order_id = ANY($1::uuid[])
      `,
      [orderIds]
    );
    const allocationCount = await client.query<{ count: string }>(
      `
        SELECT COUNT(*) AS count
        FROM inventory.stock_allocations sa
        JOIN split_allocation_demands_to_cancel d
          ON d.demand_type = sa.demand_type
         AND d.demand_id = sa.demand_id
        WHERE sa.status = 'active'
      `
    );
    console.log(
      `  releasing ${allocationCount.rows[0]?.count ?? "0"} active allocation rows on split orders`
    );

    const mismatches = await client.query<{
      order_number: string;
      item_name: string;
      ordered_qty: string;
      planned_qty: string;
      shipped_qty: string;
    }>(
      `
        SELECT
          so.order_number,
          sol.item_name,
          sol.quantity::text AS ordered_qty,
          COALESCE(SUM(ssl.quantity) FILTER (WHERE ss.status = 'planned'), 0)::text AS planned_qty,
          COALESCE(SUM(ssl.quantity) FILTER (WHERE ss.status = 'shipped'), 0)::text AS shipped_qty
        FROM sales.sales_order_lines sol
        JOIN sales.sales_orders so ON so.id = sol.sales_order_id
        LEFT JOIN sales.sales_shipment_lines ssl ON ssl.sales_order_line_id = sol.id
        LEFT JOIN sales.sales_shipments ss ON ss.id = ssl.sales_shipment_id
        WHERE sol.sales_order_id = ANY($1::uuid[])
        GROUP BY so.order_number, sol.id, sol.item_name, sol.quantity
        HAVING
          COALESCE(SUM(ssl.quantity) FILTER (WHERE ss.status IN ('planned', 'shipped')), 0)
          - sol.quantity > 0.0001
        ORDER BY so.order_number, sol.item_name
      `,
      [orderIds]
    );
    if (mismatches.rows.length > 0) {
      throw new Error(
        `Refusing to split orders whose planned/shipped shipment quantities exceed order quantities: ${JSON.stringify(
          mismatches.rows.slice(0, 20)
        )}`
      );
    }

    for (const candidate of candidates.rows) {
      const orderResult = await client.query<OrderRow>(
        `SELECT * FROM sales.sales_orders WHERE id = $1 FOR UPDATE`,
        [candidate.id]
      );
      const order = orderResult.rows[0];
      const locationId = await getDefaultLocationId(client, order.organization_id);
      const shipments = await client.query<ShipmentRow>(
        `
          SELECT *
          FROM sales.sales_shipments
          WHERE sales_order_id = $1
            AND status = 'planned'
          ORDER BY sequence, created_at, id
          FOR UPDATE
        `,
        [order.id]
      );
      console.log(
        `- ${order.order_number}: keeping first shipment, creating ${shipments.rows.length - 1} sales orders`
      );

      for (const [shipmentIndex, shipment] of shipments.rows.entries()) {
        const lines = await client.query<ShipmentLineRow>(
          `
            SELECT
              ssl.*,
              sol.unit_price,
              sol.tax_rate_id,
              sol.tax_rate_name,
              sol.tax_rate_percent,
              sol.suggested_unit_price,
              sol.pricing_source_type,
              sol.pricing_schedule_name,
              sol.pricing_break_label,
              sol.is_price_overridden,
              sol.allocation_managed_at,
              sol.allocation_managed_by
            FROM sales.sales_shipment_lines ssl
            JOIN sales.sales_order_lines sol ON sol.id = ssl.sales_order_line_id
            WHERE ssl.sales_shipment_id = $1
            ORDER BY ssl.sort_order, ssl.created_at
            FOR UPDATE
          `,
          [shipment.id]
        );

        const targetOrderNumber =
          shipmentIndex === 0 ? order.order_number : nextOrderNumber(order.order_number, shipment.sequence);
        const targetOrderId =
          shipmentIndex === 0
            ? order.id
            : (
                await client.query<{ id: string }>(
                  `
                    INSERT INTO sales.sales_orders (
                      organization_id, order_number, customer_id, customer_project_id,
                      customer_name, status, priority_rank, order_date, ship_date,
                      requested_date, notes, ship_line1, ship_line2, ship_city,
                      ship_region, ship_postcode, ship_country, billing_line1,
                      billing_line2, billing_city, billing_region, billing_postcode,
                      billing_country, subtotal_amount, tax_amount, total_amount,
                      created_at, updated_at
                    )
                    VALUES (
                      $1, $2, $3, $4, $5, 'open', NULL, $6, $7, $8, $9,
                      $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
                      $21, $22, $23, $24, now(), now()
                    )
                    RETURNING id
                  `,
                  [
                    order.organization_id,
                    targetOrderNumber,
                    order.customer_id,
                    order.customer_project_id,
                    order.customer_name,
                    order.order_date,
                    shipment.scheduled_date,
                    shipment.delivery_date,
                    order.notes,
                    order.ship_line1,
                    order.ship_line2,
                    order.ship_city,
                    order.ship_region,
                    order.ship_postcode,
                    order.ship_country,
                    order.billing_line1,
                    order.billing_line2,
                    order.billing_city,
                    order.billing_region,
                    order.billing_postcode,
                    order.billing_country,
                    lines.rows.reduce((sum, line) => {
                      return sum + toNumber(money(line.quantity, line.unit_price));
                    }, 0).toFixed(2),
                    lines.rows.reduce((sum, line) => {
                      const subtotal = money(line.quantity, line.unit_price);
                      return sum + toNumber(taxAmount(subtotal, line.tax_rate_percent));
                    }, 0).toFixed(2),
                    lines.rows.reduce((sum, line) => {
                      const subtotal = money(line.quantity, line.unit_price);
                      return sum +
                        toNumber(subtotal) +
                        toNumber(taxAmount(subtotal, line.tax_rate_percent));
                    }, 0).toFixed(2),
                  ]
                )
              ).rows[0].id;

        if (shipmentIndex > 0) {
          await client.query(
            `
              UPDATE sales.sales_shipments
              SET sales_order_id = $1,
                  order_number = $2::varchar,
                  shipment_number = $2::text || '-S1',
                  sequence = 1,
                  scheduled_date = $3,
                  delivery_date = $4,
                  updated_at = now()
              WHERE id = $5
            `,
            [targetOrderId, targetOrderNumber, shipment.scheduled_date, shipment.delivery_date, shipment.id]
          );
        }

        for (const line of lines.rows) {
          let targetLineId = line.sales_order_line_id;
          if (shipmentIndex === 0) {
            continue;
          } else {
            const insertedLine = await client.query<{ id: string }>(
              `
                INSERT INTO sales.sales_order_lines (
                  sales_order_id, item_id, item_name, item_sku, unit_name,
                  quantity, cancelled_quantity, unit_price,
                  tax_rate_id, tax_rate_name, tax_rate_percent,
                  suggested_unit_price,
                  pricing_source_type, pricing_schedule_name, pricing_break_label,
                  is_price_overridden, line_subtotal, line_tax_amount, line_total,
                  allocation_managed_at,
                  allocation_managed_by, sort_order, created_at, updated_at
                )
                VALUES (
                  $1, $2, $3, $4, $5, $6, 0, $7, $8, $9, $10, $11, $12, $13,
                  $14, $15, $16, $17, $18, $19, $20, $21, now(), now()
                )
                RETURNING id
              `,
              [
                targetOrderId,
                line.item_id,
                line.item_name,
                line.item_sku,
                line.unit_name,
                quantity(line.quantity),
                line.unit_price,
                line.tax_rate_id,
                line.tax_rate_name,
                line.tax_rate_percent,
                line.suggested_unit_price,
                line.pricing_source_type,
                line.pricing_schedule_name,
                line.pricing_break_label,
                line.is_price_overridden,
                money(line.quantity, line.unit_price),
                taxAmount(money(line.quantity, line.unit_price), line.tax_rate_percent),
                (
                  toNumber(money(line.quantity, line.unit_price)) +
                  toNumber(taxAmount(money(line.quantity, line.unit_price), line.tax_rate_percent))
                ).toFixed(2),
                line.allocation_managed_at,
                line.allocation_managed_by,
                line.sort_order,
              ]
            );
            targetLineId = insertedLine.rows[0].id;
            await client.query(
              `UPDATE sales.sales_shipment_lines SET sales_order_line_id = $1, updated_at = now() WHERE id = $2`,
              [targetLineId, line.id]
            );
            await client.query(
              `
                INSERT INTO split_moved_line_quantities (sales_order_line_id, quantity)
                VALUES ($1, $2)
                ON CONFLICT (sales_order_line_id)
                DO UPDATE SET quantity = split_moved_line_quantities.quantity + EXCLUDED.quantity
              `,
              [line.sales_order_line_id, line.quantity]
            );
            await moveLineProjection(client, {
              organizationId: order.organization_id,
              locationId,
              oldLineId: line.sales_order_line_id,
              newLineId: targetLineId,
              itemId: line.item_id,
              quantity: line.quantity,
            });
          }
        }
      }

      await client.query(
        `
          WITH moved_line_quantities AS (
            SELECT
              sales_order_line_id,
              quantity
            FROM split_moved_line_quantities
          )
          UPDATE sales.sales_order_lines sol
          SET quantity = sol.quantity - moved_line_quantities.quantity,
              cancelled_quantity = 0,
              line_subtotal = (sol.quantity - moved_line_quantities.quantity) * sol.unit_price,
              line_tax_amount = ((sol.quantity - moved_line_quantities.quantity) * sol.unit_price) * (sol.tax_rate_percent / 100),
              line_total = ((sol.quantity - moved_line_quantities.quantity) * sol.unit_price) * (1 + (sol.tax_rate_percent / 100)),
              updated_at = now()
          FROM moved_line_quantities
          WHERE sol.id = moved_line_quantities.sales_order_line_id
            AND sol.sales_order_id = $1
        `,
        [order.id]
      );
      await client.query("TRUNCATE split_moved_line_quantities");

      const keepLineIds = await client.query<{ sales_order_line_id: string }>(
        `
          SELECT sales_order_line_id
          FROM sales.sales_shipment_lines ssl
          JOIN sales.sales_shipments ss ON ss.id = ssl.sales_shipment_id
          WHERE ss.sales_order_id = $1
        `,
        [order.id]
      );
      await client.query(
        `
          DELETE FROM sales.sales_order_lines
          WHERE sales_order_id = $1
            AND quantity <= 0.0001
            AND id <> ALL($2::uuid[])
        `,
        [order.id, keepLineIds.rows.map((row) => row.sales_order_line_id)]
      );
      const originalTotal = await client.query<{
        subtotal_amount: string;
        tax_amount: string;
        total_amount: string;
      }>(
        `
          SELECT
            COALESCE(SUM(line_subtotal), 0)::text AS subtotal_amount,
            COALESCE(SUM(line_tax_amount), 0)::text AS tax_amount,
            COALESCE(SUM(line_total), 0)::text AS total_amount
          FROM sales.sales_order_lines
          WHERE sales_order_id = $1
        `,
        [order.id]
      );
      await client.query(
        `
          UPDATE sales.sales_orders
          SET ship_date = planned.scheduled_date,
              requested_date = planned.delivery_date,
              subtotal_amount = $2,
              tax_amount = $3,
              total_amount = $4,
              updated_at = now()
          FROM LATERAL (
            SELECT scheduled_date, delivery_date
            FROM sales.sales_shipments
            WHERE sales_order_id = $1
              AND status = 'planned'
            ORDER BY sequence, created_at, id
            LIMIT 1
          ) planned
          WHERE sales.sales_orders.id = $1
        `,
        [
          order.id,
          originalTotal.rows[0]?.subtotal_amount ?? "0",
          originalTotal.rows[0]?.tax_amount ?? "0",
          originalTotal.rows[0]?.total_amount ?? "0",
        ]
      );
    }

    const cancelledAllocations = await client.query<{ id: string }>(
      `
        UPDATE inventory.stock_allocations sa
        SET status = 'cancelled',
            cancelled_at = now(),
            updated_at = now()
        FROM split_allocation_demands_to_cancel d
        WHERE d.demand_type = sa.demand_type
          AND d.demand_id = sa.demand_id
          AND sa.status = 'active'
        RETURNING sa.id
      `
    );
    console.log(`  released ${cancelledAllocations.rows.length} allocation rows.`);

    if (apply) {
      await client.query("COMMIT");
      console.log("Applied split migration.");
    } else {
      await client.query("ROLLBACK");
      console.log("Dry run rolled back. Re-run with --apply to mutate data.");
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
