import {
  uuid,
  varchar,
  text,
  numeric,
  timestamp,
  pgPolicy,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { inventorySchema, unitDefinitions } from "./units";

export const items = inventorySchema
  .table(
    "items",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      name: varchar("name", { length: 255 }).notNull(),
      description: text("description"),
      sku: varchar("sku", { length: 50 }),
      category: varchar("category", { length: 100 }),

      // Display/filtering (material, product, semi-finished, etc.)
      itemType: varchar("item_type", { length: 20 }).notNull().default("material"),

      // Units
      unitDefinitionId: uuid("unit_definition_id")
        .notNull()
        .references(() => unitDefinitions.id),

      // Stock
      safetyStock: numeric("safety_stock", { precision: 12, scale: 4 }).notNull().default("0"),
      committedQty: numeric("committed_qty", { precision: 12, scale: 4 }).notNull().default("0"),
      expectedQty: numeric("expected_qty", { precision: 12, scale: 4 }).notNull().default("0"),

      // Pricing
      defaultPurchasePrice: numeric("default_purchase_price", { precision: 10, scale: 4 }),
      defaultSellingPrice: numeric("default_selling_price", { precision: 10, scale: 2 }),

      // BOM mode — "quantity" or "percentage", null for non-products
      bomMode: varchar("bom_mode", { length: 20 }),

      // Soft delete
      deletedAt: timestamp("deleted_at"),

      // Timestamps
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => [
      index("items_org_id_idx").on(table.organizationId),
      index("items_active_idx")
        .on(table.organizationId)
        .where(sql`deleted_at IS NULL`),
      uniqueIndex("items_org_sku_uidx")
        .on(table.organizationId, table.sku)
        .where(sql`sku IS NOT NULL AND deleted_at IS NULL`),
      pgPolicy("items_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();
