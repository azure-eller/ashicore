import {
  index,
  integer,
  numeric,
  pgPolicy,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { items } from "./items";
import { inventorySchema } from "./units";

export const stocktakes = inventorySchema
  .table(
    "stocktakes",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      name: varchar("name", { length: 255 }).notNull(),
      scope: varchar("scope", { length: 255 }).notNull().default("all"),
      status: varchar("status", { length: 20 }).notNull().default("draft"),
      notes: text("notes"),
      completedAt: timestamp("completed_at", { withTimezone: true }),
      cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("stocktakes_org_id_idx").on(table.organizationId),
      index("stocktakes_status_idx").on(table.status),
      index("stocktakes_created_at_idx").on(table.createdAt),
      pgPolicy("stocktakes_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const stocktakeItems = inventorySchema
  .table(
    "stocktake_items",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      stocktakeId: uuid("stocktake_id")
        .notNull()
        .references(() => stocktakes.id),
      itemId: uuid("item_id")
        .notNull()
        .references(() => items.id),
      itemName: varchar("item_name", { length: 255 }).notNull(),
      itemSku: varchar("item_sku", { length: 50 }),
      itemType: varchar("item_type", { length: 20 }).notNull(),
      unitName: varchar("unit_name", { length: 50 }).notNull(),
      expectedQty: numeric("expected_qty", { precision: 12, scale: 4 }).notNull(),
      countedQty: numeric("counted_qty", { precision: 12, scale: 4 }),
      varianceQty: numeric("variance_qty", { precision: 12, scale: 4 }),
      appliedDeltaQty: numeric("applied_delta_qty", { precision: 12, scale: 4 }),
      sortOrder: integer("sort_order").notNull().default(0),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("stocktake_items_stocktake_id_idx").on(table.stocktakeId),
      index("stocktake_items_item_id_idx").on(table.itemId),
      uniqueIndex("stocktake_items_stocktake_item_uidx").on(
        table.stocktakeId,
        table.itemId
      ),
      pgPolicy("stocktake_items_org_isolation", {
        for: "all",
        to: "public",
        using: sql`stocktake_id IN (
          SELECT id
          FROM inventory.stocktakes
          WHERE organization_id = current_setting('app.current_org_id', true)
        )`,
        withCheck: sql`stocktake_id IN (
          SELECT id
          FROM inventory.stocktakes
          WHERE organization_id = current_setting('app.current_org_id', true)
        )`,
      }),
    ]
  )
  .enableRLS();
