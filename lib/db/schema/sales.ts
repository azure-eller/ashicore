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

export const salesSchema = pgSchema("sales");

export const customers = salesSchema
  .table(
    "customers",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      name: varchar("name", { length: 255 }).notNull(),
      email: varchar("email", { length: 255 }),
      phone: varchar("phone", { length: 50 }),
      address: text("address"),
      notes: text("notes"),
      deletedAt: timestamp("deleted_at"),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => [
      index("sales_customers_org_id_idx").on(table.organizationId),
      index("sales_customers_active_idx")
        .on(table.organizationId)
        .where(sql`deleted_at IS NULL`),
      index("sales_customers_name_idx").on(table.name),
      pgPolicy("sales_customers_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const salesOrders = salesSchema
  .table(
    "sales_orders",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      orderNumber: varchar("order_number", { length: 32 }).notNull(),
      customerId: uuid("customer_id")
        .notNull()
        .references(() => customers.id),
      customerName: varchar("customer_name", { length: 255 }).notNull(),
      status: varchar("status", { length: 20 }).notNull().default("draft"),
      requestedDate: date("requested_date", { mode: "string" }),
      notes: text("notes"),
      fulfilledAt: timestamp("fulfilled_at"),
      totalAmount: numeric("total_amount", { precision: 12, scale: 2 })
        .notNull()
        .default("0"),
      deletedAt: timestamp("deleted_at"),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => [
      index("sales_orders_org_id_idx").on(table.organizationId),
      index("sales_orders_active_idx")
        .on(table.organizationId)
        .where(sql`deleted_at IS NULL`),
      index("sales_orders_status_idx").on(table.status),
      index("sales_orders_created_at_idx").on(table.createdAt),
      uniqueIndex("sales_orders_org_order_number_uidx").on(
        table.organizationId,
        table.orderNumber
      ),
      pgPolicy("sales_orders_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const salesOrderLines = salesSchema
  .table(
    "sales_order_lines",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      salesOrderId: uuid("sales_order_id")
        .notNull()
        .references(() => salesOrders.id),
      itemId: uuid("item_id")
        .notNull()
        .references(() => items.id),
      itemName: varchar("item_name", { length: 255 }).notNull(),
      itemSku: varchar("item_sku", { length: 50 }),
      unitName: varchar("unit_name", { length: 50 }).notNull(),
      quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull(),
      unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
      lineTotal: numeric("line_total", { precision: 12, scale: 2 }).notNull(),
      sortOrder: integer("sort_order").notNull().default(0),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => [
      index("sales_order_lines_order_id_idx").on(table.salesOrderId),
      index("sales_order_lines_item_id_idx").on(table.itemId),
      uniqueIndex("sales_order_lines_order_item_uidx").on(
        table.salesOrderId,
        table.itemId
      ),
      pgPolicy("sales_order_lines_org_isolation", {
        for: "all",
        to: "public",
        using: sql`sales_order_id IN (
          SELECT id
          FROM sales.sales_orders
          WHERE organization_id = current_setting('app.current_org_id', true)
        )`,
        withCheck: sql`sales_order_id IN (
          SELECT id
          FROM sales.sales_orders
          WHERE organization_id = current_setting('app.current_org_id', true)
        )`,
      }),
    ]
  )
  .enableRLS();
