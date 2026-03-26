import {
  date,
  index,
  integer,
  numeric,
  pgPolicy,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { items } from "./items";
import { salesOrders } from "./sales";

export const manufacturingSchema = pgSchema("manufacturing");

export const manufacturingOrders = manufacturingSchema
  .table(
    "manufacturing_orders",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      orderNumber: varchar("order_number", { length: 32 }).notNull(),
      productId: uuid("product_id")
        .notNull()
        .references(() => items.id),
      salesOrderId: uuid("sales_order_id").references(() => salesOrders.id),
      // Stored as a plain UUID snapshot reference so draft sales-order edits can
      // replace line rows without being blocked by FK constraints.
      salesOrderLineId: uuid("sales_order_line_id"),
      productName: varchar("product_name", { length: 255 }).notNull(),
      productSku: varchar("product_sku", { length: 50 }),
      unitName: varchar("unit_name", { length: 50 }).notNull(),
      salesOrderNumber: varchar("sales_order_number", { length: 32 }),
      salesCustomerName: varchar("sales_customer_name", { length: 255 }),
      status: varchar("status", { length: 20 }).notNull().default("draft"),
      plannedQuantity: numeric("planned_quantity", { precision: 12, scale: 4 })
        .notNull(),
      actualQuantity: numeric("actual_quantity", { precision: 12, scale: 4 }),
      plannedDate: date("planned_date", { mode: "string" }),
      actualMaterialCost: numeric("actual_material_cost", {
        precision: 12,
        scale: 4,
      }),
      actualCostPerUnit: numeric("actual_cost_per_unit", {
        precision: 12,
        scale: 4,
      }),
      notes: text("notes"),
      releasedAt: timestamp("released_at"),
      completedAt: timestamp("completed_at"),
      cancelledAt: timestamp("cancelled_at"),
      deletedAt: timestamp("deleted_at"),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => [
      index("manufacturing_orders_org_id_idx").on(table.organizationId),
      index("manufacturing_orders_active_idx")
        .on(table.organizationId)
        .where(sql`deleted_at IS NULL`),
      index("manufacturing_orders_status_idx").on(table.status),
      index("manufacturing_orders_product_id_idx").on(table.productId),
      index("manufacturing_orders_sales_order_id_idx").on(table.salesOrderId),
      index("manufacturing_orders_planned_date_idx").on(table.plannedDate),
      index("manufacturing_orders_created_at_idx").on(table.createdAt),
      uniqueIndex("manufacturing_orders_org_order_number_uidx").on(
        table.organizationId,
        table.orderNumber
      ),
      pgPolicy("manufacturing_orders_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const manufacturingOrderIngredients = manufacturingSchema
  .table(
    "manufacturing_order_ingredients",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      manufacturingOrderId: uuid("manufacturing_order_id")
        .notNull()
        .references(() => manufacturingOrders.id, { onDelete: "cascade" }),
      itemId: uuid("item_id")
        .notNull()
        .references(() => items.id),
      itemName: varchar("item_name", { length: 255 }).notNull(),
      itemSku: varchar("item_sku", { length: 50 }),
      itemType: varchar("item_type", { length: 20 }).notNull(),
      unitName: varchar("unit_name", { length: 50 }).notNull(),
      quantityPerUnit: numeric("quantity_per_unit", { precision: 12, scale: 4 })
        .notNull(),
      plannedQuantity: numeric("planned_quantity", { precision: 12, scale: 4 })
        .notNull(),
      actualQuantity: numeric("actual_quantity", { precision: 12, scale: 4 }),
      actualCostTotal: numeric("actual_cost_total", {
        precision: 12,
        scale: 4,
      }),
      sortOrder: integer("sort_order").notNull().default(0),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => [
      index("manufacturing_order_ingredients_order_id_idx").on(
        table.manufacturingOrderId
      ),
      index("manufacturing_order_ingredients_item_id_idx").on(table.itemId),
      uniqueIndex("manufacturing_order_ingredients_order_item_uidx").on(
        table.manufacturingOrderId,
        table.itemId
      ),
      pgPolicy("manufacturing_order_ingredients_org_isolation", {
        for: "all",
        to: "public",
        using: sql`manufacturing_order_id IN (
          SELECT id
          FROM manufacturing.manufacturing_orders
          WHERE organization_id = current_setting('app.current_org_id', true)
        )`,
        withCheck: sql`manufacturing_order_id IN (
          SELECT id
          FROM manufacturing.manufacturing_orders
          WHERE organization_id = current_setting('app.current_org_id', true)
        )`,
      }),
    ]
  )
  .enableRLS();
