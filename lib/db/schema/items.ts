import {
  uuid,
  varchar,
  text,
  numeric,
  timestamp,
} from "drizzle-orm/pg-core";
import { inventorySchema, unitDefinitions } from "./units";

export const items = inventorySchema.table("items", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
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
  inStock: numeric("in_stock", { precision: 12, scale: 4 }).notNull().default("0"),
  safetyStock: numeric("safety_stock", { precision: 12, scale: 4 }).notNull().default("0"),
  committedQty: numeric("committed_qty", { precision: 12, scale: 4 }).notNull().default("0"),
  expectedQty: numeric("expected_qty", { precision: 12, scale: 4 }).notNull().default("0"),

  // Pricing
  defaultPurchasePrice: numeric("default_purchase_price", { precision: 10, scale: 4 }),
  defaultSellingPrice: numeric("default_selling_price", { precision: 10, scale: 2 }),

  // Soft delete
  deletedAt: timestamp("deleted_at"),

  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
