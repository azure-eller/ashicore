import { sql } from "drizzle-orm";
import { Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { Pool as PgPool } from "pg";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import type { db as appDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";

export type ResetCounts = Array<{ table: string; rows: number }>;
type AppDb = typeof appDb;

type CountStep = {
  table: string;
  count: (tx: Tx, orgId: string) => Promise<number>;
  delete: (tx: Tx, orgId: string) => Promise<void>;
};

async function readCount(
  tx: Tx,
  query: ReturnType<typeof sql>
): Promise<number> {
  const result = await tx.execute(query);
  const row = result.rows[0] as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

const STEPS: CountStep[] = [
  // ───────────── Inventory ledger / projections ─────────────
  {
    table: "inventory.inventory_idempotency_claims",
    count: (tx, orgId) =>
      readCount(
        tx,
        sql`
          SELECT COUNT(*)::int AS n FROM inventory.inventory_idempotency_claims
          WHERE organization_id = ${orgId}
            OR first_event_id IN (
              SELECT e.id FROM inventory.inventory_events e
              WHERE e.organization_id = ${orgId}
                OR e.lot_id IN (SELECT id FROM inventory.lots WHERE organization_id = ${orgId})
                OR e.item_id IN (SELECT id FROM inventory.items WHERE organization_id = ${orgId})
            )
        `
      ),
    delete: async (tx, orgId) => {
      await tx.execute(sql`
        DELETE FROM inventory.inventory_idempotency_claims
        WHERE organization_id = ${orgId}
          OR first_event_id IN (
            SELECT e.id FROM inventory.inventory_events e
            WHERE e.organization_id = ${orgId}
              OR e.lot_id IN (SELECT id FROM inventory.lots WHERE organization_id = ${orgId})
              OR e.item_id IN (SELECT id FROM inventory.items WHERE organization_id = ${orgId})
          )
      `);
    },
  },
  {
    table: "inventory.inventory_lot_balances",
    count: (tx, orgId) =>
      readCount(
        tx,
        sql`SELECT COUNT(*)::int AS n FROM inventory.inventory_lot_balances WHERE organization_id = ${orgId}`
      ),
    delete: async (tx, orgId) => {
      await tx.execute(
        sql`DELETE FROM inventory.inventory_lot_balances WHERE organization_id = ${orgId}`
      );
    },
  },
  {
    table: "inventory.inventory_item_balances",
    count: (tx, orgId) =>
      readCount(
        tx,
        sql`SELECT COUNT(*)::int AS n FROM inventory.inventory_item_balances WHERE organization_id = ${orgId}`
      ),
    delete: async (tx, orgId) => {
      await tx.execute(
        sql`DELETE FROM inventory.inventory_item_balances WHERE organization_id = ${orgId}`
      );
    },
  },
  {
    table: "inventory.inventory_reservations_summary",
    count: (tx, orgId) =>
      readCount(
        tx,
        sql`SELECT COUNT(*)::int AS n FROM inventory.inventory_reservations_summary WHERE organization_id = ${orgId}`
      ),
    delete: async (tx, orgId) => {
      await tx.execute(
        sql`DELETE FROM inventory.inventory_reservations_summary WHERE organization_id = ${orgId}`
      );
    },
  },
  {
    table: "inventory.inventory_expected_summary",
    count: (tx, orgId) =>
      readCount(
        tx,
        sql`SELECT COUNT(*)::int AS n FROM inventory.inventory_expected_summary WHERE organization_id = ${orgId}`
      ),
    delete: async (tx, orgId) => {
      await tx.execute(
        sql`DELETE FROM inventory.inventory_expected_summary WHERE organization_id = ${orgId}`
      );
    },
  },
  {
    table: "inventory.inventory_demands_summary",
    count: (tx, orgId) =>
      readCount(
        tx,
        sql`SELECT COUNT(*)::int AS n FROM inventory.inventory_demands_summary WHERE organization_id = ${orgId}`
      ),
    delete: async (tx, orgId) => {
      await tx.execute(
        sql`DELETE FROM inventory.inventory_demands_summary WHERE organization_id = ${orgId}`
      );
    },
  },
  {
    table: "inventory.quality_disposition_events",
    count: (tx, orgId) =>
      readCount(
        tx,
        sql`
          SELECT COUNT(*)::int AS n FROM inventory.quality_disposition_events
          WHERE organization_id = ${orgId}
            OR inventory_event_id IN (
              SELECT e.id FROM inventory.inventory_events e
              WHERE e.organization_id = ${orgId}
                OR e.lot_id IN (SELECT id FROM inventory.lots WHERE organization_id = ${orgId})
                OR e.item_id IN (SELECT id FROM inventory.items WHERE organization_id = ${orgId})
            )
            OR lot_id IN (SELECT id FROM inventory.lots WHERE organization_id = ${orgId})
        `
      ),
    delete: async (tx, orgId) => {
      await tx.execute(sql`
        DELETE FROM inventory.quality_disposition_events
        WHERE organization_id = ${orgId}
          OR inventory_event_id IN (
            SELECT e.id FROM inventory.inventory_events e
            WHERE e.organization_id = ${orgId}
              OR e.lot_id IN (SELECT id FROM inventory.lots WHERE organization_id = ${orgId})
              OR e.item_id IN (SELECT id FROM inventory.items WHERE organization_id = ${orgId})
          )
          OR lot_id IN (SELECT id FROM inventory.lots WHERE organization_id = ${orgId})
      `);
    },
  },
  {
    table: "inventory.inventory_events",
    count: (tx, orgId) =>
      readCount(
        tx,
        sql`
          SELECT COUNT(*)::int AS n FROM inventory.inventory_events
          WHERE organization_id = ${orgId}
            OR lot_id IN (SELECT id FROM inventory.lots WHERE organization_id = ${orgId})
            OR item_id IN (SELECT id FROM inventory.items WHERE organization_id = ${orgId})
        `
      ),
    delete: async (tx, orgId) => {
      await tx.execute(sql`
        DELETE FROM inventory.inventory_events
        WHERE organization_id = ${orgId}
          OR lot_id IN (SELECT id FROM inventory.lots WHERE organization_id = ${orgId})
          OR item_id IN (SELECT id FROM inventory.items WHERE organization_id = ${orgId})
      `);
    },
  },

  // ───────────── Manufacturing (children → parents) ─────────────
  {
    table: "manufacturing.manufacturing_pick_allocations",
    count: (tx, orgId) =>
      readCount(
        tx,
        sql`
          SELECT COUNT(*)::int AS n FROM manufacturing.manufacturing_pick_allocations
          WHERE manufacturing_order_ingredient_id IN (
            SELECT i.id FROM manufacturing.manufacturing_order_ingredients i
            INNER JOIN manufacturing.manufacturing_orders o ON o.id = i.manufacturing_order_id
            WHERE o.organization_id = ${orgId}
          )
        `
      ),
    delete: async (tx, orgId) => {
      await tx.execute(sql`
        DELETE FROM manufacturing.manufacturing_pick_allocations
        WHERE manufacturing_order_ingredient_id IN (
          SELECT i.id FROM manufacturing.manufacturing_order_ingredients i
          INNER JOIN manufacturing.manufacturing_orders o ON o.id = i.manufacturing_order_id
          WHERE o.organization_id = ${orgId}
        )
      `);
    },
  },
  {
    table: "manufacturing.manufacturing_order_ingredients",
    count: (tx, orgId) =>
      readCount(
        tx,
        sql`
          SELECT COUNT(*)::int AS n FROM manufacturing.manufacturing_order_ingredients
          WHERE manufacturing_order_id IN (
            SELECT id FROM manufacturing.manufacturing_orders WHERE organization_id = ${orgId}
          )
        `
      ),
    delete: async (tx, orgId) => {
      await tx.execute(sql`
        DELETE FROM manufacturing.manufacturing_order_ingredients
        WHERE manufacturing_order_id IN (
          SELECT id FROM manufacturing.manufacturing_orders WHERE organization_id = ${orgId}
        )
      `);
    },
  },
  {
    table: "manufacturing.manufacturing_order_batches",
    count: (tx, orgId) =>
      readCount(
        tx,
        sql`
          SELECT COUNT(*)::int AS n FROM manufacturing.manufacturing_order_batches
          WHERE manufacturing_order_id IN (
            SELECT id FROM manufacturing.manufacturing_orders WHERE organization_id = ${orgId}
          )
        `
      ),
    delete: async (tx, orgId) => {
      await tx.execute(sql`
        DELETE FROM manufacturing.manufacturing_order_batches
        WHERE manufacturing_order_id IN (
          SELECT id FROM manufacturing.manufacturing_orders WHERE organization_id = ${orgId}
        )
      `);
    },
  },
  {
    table: "manufacturing.manufacturing_orders",
    count: (tx, orgId) =>
      readCount(
        tx,
        sql`SELECT COUNT(*)::int AS n FROM manufacturing.manufacturing_orders WHERE organization_id = ${orgId}`
      ),
    delete: async (tx, orgId) => {
      await tx.execute(
        sql`DELETE FROM manufacturing.manufacturing_orders WHERE organization_id = ${orgId}`
      );
    },
  },

  // ───────────── Purchasing ─────────────
  {
    table: "purchasing.purchase_order_lines",
    count: (tx, orgId) =>
      readCount(
        tx,
        sql`
          SELECT COUNT(*)::int AS n FROM purchasing.purchase_order_lines
          WHERE purchase_order_id IN (
            SELECT id FROM purchasing.purchase_orders WHERE organization_id = ${orgId}
          )
        `
      ),
    delete: async (tx, orgId) => {
      await tx.execute(sql`
        DELETE FROM purchasing.purchase_order_lines
        WHERE purchase_order_id IN (
          SELECT id FROM purchasing.purchase_orders WHERE organization_id = ${orgId}
        )
      `);
    },
  },
  {
    table: "purchasing.purchase_orders",
    count: (tx, orgId) =>
      readCount(
        tx,
        sql`SELECT COUNT(*)::int AS n FROM purchasing.purchase_orders WHERE organization_id = ${orgId}`
      ),
    delete: async (tx, orgId) => {
      await tx.execute(
        sql`DELETE FROM purchasing.purchase_orders WHERE organization_id = ${orgId}`
      );
    },
  },
  {
    table: "purchasing.suppliers",
    count: (tx, orgId) =>
      readCount(
        tx,
        sql`SELECT COUNT(*)::int AS n FROM purchasing.suppliers WHERE organization_id = ${orgId}`
      ),
    delete: async (tx, orgId) => {
      await tx.execute(
        sql`DELETE FROM purchasing.suppliers WHERE organization_id = ${orgId}`
      );
    },
  },

  // ───────────── Stocktakes ─────────────
  {
    table: "inventory.stocktake_items",
    count: (tx, orgId) =>
      readCount(
        tx,
        sql`
          SELECT COUNT(*)::int AS n FROM inventory.stocktake_items
          WHERE stocktake_id IN (
            SELECT id FROM inventory.stocktakes WHERE organization_id = ${orgId}
          )
        `
      ),
    delete: async (tx, orgId) => {
      await tx.execute(sql`
        DELETE FROM inventory.stocktake_items
        WHERE stocktake_id IN (
          SELECT id FROM inventory.stocktakes WHERE organization_id = ${orgId}
        )
      `);
    },
  },
  {
    table: "inventory.stocktakes",
    count: (tx, orgId) =>
      readCount(
        tx,
        sql`SELECT COUNT(*)::int AS n FROM inventory.stocktakes WHERE organization_id = ${orgId}`
      ),
    delete: async (tx, orgId) => {
      await tx.execute(
        sql`DELETE FROM inventory.stocktakes WHERE organization_id = ${orgId}`
      );
    },
  },

  // ───────────── Sales ─────────────
  {
    table: "sales.sales_shipment_costs",
    count: (tx, orgId) =>
      readCount(
        tx,
        sql`SELECT COUNT(*)::int AS n FROM sales.sales_shipment_costs WHERE organization_id = ${orgId}`
      ),
    delete: async (tx, orgId) => {
      await tx.execute(
        sql`DELETE FROM sales.sales_shipment_costs WHERE organization_id = ${orgId}`
      );
    },
  },
  {
    table: "sales.sales_shipment_lines",
    count: (tx, orgId) =>
      readCount(
        tx,
        sql`
          SELECT COUNT(*)::int AS n FROM sales.sales_shipment_lines
          WHERE sales_shipment_id IN (
            SELECT id FROM sales.sales_shipments WHERE organization_id = ${orgId}
          )
        `
      ),
    delete: async (tx, orgId) => {
      await tx.execute(sql`
        DELETE FROM sales.sales_shipment_lines
        WHERE sales_shipment_id IN (
          SELECT id FROM sales.sales_shipments WHERE organization_id = ${orgId}
        )
      `);
    },
  },
  {
    table: "sales.sales_shipments",
    count: (tx, orgId) =>
      readCount(
        tx,
        sql`SELECT COUNT(*)::int AS n FROM sales.sales_shipments WHERE organization_id = ${orgId}`
      ),
    delete: async (tx, orgId) => {
      await tx.execute(
        sql`DELETE FROM sales.sales_shipments WHERE organization_id = ${orgId}`
      );
    },
  },
  {
    table: "sales.sales_order_lines",
    count: (tx, orgId) =>
      readCount(
        tx,
        sql`
          SELECT COUNT(*)::int AS n FROM sales.sales_order_lines
          WHERE sales_order_id IN (
            SELECT id FROM sales.sales_orders WHERE organization_id = ${orgId}
          )
        `
      ),
    delete: async (tx, orgId) => {
      await tx.execute(sql`
        DELETE FROM sales.sales_order_lines
        WHERE sales_order_id IN (
          SELECT id FROM sales.sales_orders WHERE organization_id = ${orgId}
        )
      `);
    },
  },
  {
    table: "sales.sales_orders",
    count: (tx, orgId) =>
      readCount(
        tx,
        sql`SELECT COUNT(*)::int AS n FROM sales.sales_orders WHERE organization_id = ${orgId}`
      ),
    delete: async (tx, orgId) => {
      await tx.execute(
        sql`DELETE FROM sales.sales_orders WHERE organization_id = ${orgId}`
      );
    },
  },
  {
    table: "sales.pricing_schedule_breaks",
    count: (tx, orgId) =>
      readCount(
        tx,
        sql`
          SELECT COUNT(*)::int AS n FROM sales.pricing_schedule_breaks
          WHERE pricing_schedule_id IN (
            SELECT id FROM sales.pricing_schedules WHERE organization_id = ${orgId}
          )
        `
      ),
    delete: async (tx, orgId) => {
      await tx.execute(sql`
        DELETE FROM sales.pricing_schedule_breaks
        WHERE pricing_schedule_id IN (
          SELECT id FROM sales.pricing_schedules WHERE organization_id = ${orgId}
        )
      `);
    },
  },
  {
    table: "sales.pricing_schedules",
    count: (tx, orgId) =>
      readCount(
        tx,
        sql`SELECT COUNT(*)::int AS n FROM sales.pricing_schedules WHERE organization_id = ${orgId}`
      ),
    delete: async (tx, orgId) => {
      await tx.execute(
        sql`DELETE FROM sales.pricing_schedules WHERE organization_id = ${orgId}`
      );
    },
  },
  {
    table: "sales.customers",
    count: (tx, orgId) =>
      readCount(
        tx,
        sql`SELECT COUNT(*)::int AS n FROM sales.customers WHERE organization_id = ${orgId}`
      ),
    delete: async (tx, orgId) => {
      await tx.execute(
        sql`DELETE FROM sales.customers WHERE organization_id = ${orgId}`
      );
    },
  },
  {
    table: "sales.customer_categories",
    count: (tx, orgId) =>
      readCount(
        tx,
        sql`SELECT COUNT(*)::int AS n FROM sales.customer_categories WHERE organization_id = ${orgId}`
      ),
    delete: async (tx, orgId) => {
      await tx.execute(
        sql`DELETE FROM sales.customer_categories WHERE organization_id = ${orgId}`
      );
    },
  },

  // ───────────── Inventory core ─────────────
  {
    table: "inventory.lots",
    count: (tx, orgId) =>
      readCount(tx, sql`SELECT COUNT(*)::int AS n FROM inventory.lots WHERE organization_id = ${orgId}`),
    delete: async (tx, orgId) => {
      await tx.execute(sql`DELETE FROM inventory.lots WHERE organization_id = ${orgId}`);
    },
  },
  {
    table: "inventory.bom_revision_components",
    count: (tx, orgId) =>
      readCount(
        tx,
        sql`
          SELECT COUNT(*)::int AS n FROM inventory.bom_revision_components
          WHERE bom_revision_id IN (
            SELECT id FROM inventory.bom_revisions WHERE organization_id = ${orgId}
          )
        `
      ),
    delete: async (tx, orgId) => {
      await tx.execute(sql`
        DELETE FROM inventory.bom_revision_components
        WHERE bom_revision_id IN (
          SELECT id FROM inventory.bom_revisions WHERE organization_id = ${orgId}
        )
      `);
    },
  },
  {
    table: "inventory.bom_revisions",
    count: (tx, orgId) =>
      readCount(
        tx,
        sql`SELECT COUNT(*)::int AS n FROM inventory.bom_revisions WHERE organization_id = ${orgId}`
      ),
    delete: async (tx, orgId) => {
      await tx.execute(
        sql`DELETE FROM inventory.bom_revisions WHERE organization_id = ${orgId}`
      );
    },
  },
  {
    table: "inventory.items",
    count: (tx, orgId) =>
      readCount(tx, sql`SELECT COUNT(*)::int AS n FROM inventory.items WHERE organization_id = ${orgId}`),
    delete: async (tx, orgId) => {
      await tx.execute(sql`DELETE FROM inventory.items WHERE organization_id = ${orgId}`);
    },
  },
  {
    table: "inventory.unit_definitions",
    count: (tx, orgId) =>
      readCount(
        tx,
        sql`SELECT COUNT(*)::int AS n FROM inventory.unit_definitions WHERE organization_id = ${orgId}`
      ),
    delete: async (tx, orgId) => {
      await tx.execute(
        sql`DELETE FROM inventory.unit_definitions WHERE organization_id = ${orgId}`
      );
    },
  },
  {
    table: "inventory.locations",
    count: (tx, orgId) =>
      readCount(
        tx,
        sql`SELECT COUNT(*)::int AS n FROM inventory.locations WHERE organization_id = ${orgId}`
      ),
    delete: async (tx, orgId) => {
      await tx.execute(
        sql`DELETE FROM inventory.locations WHERE organization_id = ${orgId}`
      );
    },
  },
];

function createResetDb(): { db: AppDb; close: () => Promise<void> } {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is required for reset because reset deletes append-only inventory events."
    );
  }

  if (connectionString.includes(".neon.tech")) {
    const pool = new NeonPool({ connectionString });
    return {
      db: drizzleNeon({ client: pool, schema }) as unknown as AppDb,
      close: () => pool.end(),
    };
  }

  const pool = new PgPool({ connectionString });
  return {
    db: drizzlePg({ client: pool, schema }) as unknown as AppDb,
    close: () => pool.end(),
  };
}

async function withResetOrgContext<T>(
  orgId: string,
  callback: (tx: Tx) => Promise<T>
): Promise<T> {
  const resetDb = createResetDb();

  try {
    return await resetDb.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
      return callback(tx as unknown as Tx);
    });
  } finally {
    await resetDb.close();
  }
}

export async function previewReset(orgId: string): Promise<ResetCounts> {
  return withResetOrgContext(orgId, async (tx) => {
    const counts: ResetCounts = [];
    for (const step of STEPS) {
      counts.push({ table: step.table, rows: await step.count(tx, orgId) });
    }
    return counts;
  });
}

export async function applyReset(orgId: string): Promise<ResetCounts> {
  return withResetOrgContext(orgId, async (tx) => {
    const counts: ResetCounts = [];
    for (const step of STEPS) {
      const rows = await step.count(tx, orgId);
      if (rows > 0) {
        await step.delete(tx, orgId);
      }
      counts.push({ table: step.table, rows });
    }
    return counts;
  });
}
