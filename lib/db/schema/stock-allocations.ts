import {
  check,
  index,
  numeric,
  pgPolicy,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { inventorySchema } from "./units";
import { items } from "./items";

export const STOCK_ALLOCATION_DEMAND_TYPES = ["sales_order_line"] as const;
export type StockAllocationDemandType =
  (typeof STOCK_ALLOCATION_DEMAND_TYPES)[number];

export const STOCK_ALLOCATION_SOURCE_TYPES = [
  "stock_pool",
  "lot",
  "manufacturing_order",
] as const;
export type StockAllocationSourceType =
  (typeof STOCK_ALLOCATION_SOURCE_TYPES)[number];

export const STOCK_ALLOCATION_STATUSES = ["active", "consumed", "cancelled"] as const;
export type StockAllocationStatus = (typeof STOCK_ALLOCATION_STATUSES)[number];

export const stockAllocations = inventorySchema
  .table(
    "stock_allocations",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      demandType: varchar("demand_type", { length: 40 }).notNull(),
      demandId: uuid("demand_id").notNull(),
      itemId: uuid("item_id")
        .notNull()
        .references(() => items.id),
      sourceType: varchar("source_type", { length: 40 }).notNull(),
      sourceId: uuid("source_id"),
      quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull(),
      status: varchar("status", { length: 20 }).notNull().default("active"),
      demandLabelSnapshot: text("demand_label_snapshot"),
      sourceLabelSnapshot: text("source_label_snapshot"),
      notes: text("notes"),
      createdBy: text("created_by"),
      updatedBy: text("updated_by"),
      cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
      cancelledBy: text("cancelled_by"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("stock_allocations_org_item_status_idx").on(
        table.organizationId,
        table.itemId,
        table.status
      ),
      index("stock_allocations_demand_idx").on(
        table.organizationId,
        table.demandType,
        table.demandId,
        table.status
      ),
      index("stock_allocations_source_idx").on(
        table.organizationId,
        table.sourceType,
        table.sourceId,
        table.status
      ),
      index("stock_allocations_item_source_idx").on(
        table.organizationId,
        table.itemId,
        table.sourceType,
        table.sourceId,
        table.status
      ),
      uniqueIndex("stock_allocations_active_stock_pool_uidx")
        .on(table.organizationId, table.demandType, table.demandId, table.sourceType)
        .where(sql`status = 'active' AND source_type = 'stock_pool'`),
      uniqueIndex("stock_allocations_active_source_uidx")
        .on(
          table.organizationId,
          table.demandType,
          table.demandId,
          table.sourceType,
          table.sourceId
        )
        .where(sql`status = 'active' AND source_type <> 'stock_pool'`),
      check(
        "stock_allocations_demand_type_check",
        sql`${table.demandType} IN ('sales_order_line')`
      ),
      check(
        "stock_allocations_source_type_check",
        sql`${table.sourceType} IN ('stock_pool', 'lot', 'manufacturing_order')`
      ),
      check(
        "stock_allocations_status_check",
        sql`${table.status} IN ('active', 'consumed', 'cancelled')`
      ),
      check("stock_allocations_quantity_check", sql`${table.quantity} > 0`),
      check(
        "stock_allocations_source_id_check",
        sql`(${table.sourceType} = 'stock_pool' AND ${table.sourceId} IS NULL) OR (${table.sourceType} <> 'stock_pool' AND ${table.sourceId} IS NOT NULL)`
      ),
      check(
        "stock_allocations_cancelled_check",
        sql`(${table.status} = 'cancelled' AND ${table.cancelledAt} IS NOT NULL) OR (${table.status} <> 'cancelled' AND ${table.cancelledAt} IS NULL)`
      ),
      pgPolicy("stock_allocations_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();
