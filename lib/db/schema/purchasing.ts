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

export const purchasingSchema = pgSchema("purchasing");

export const suppliers = purchasingSchema
  .table(
    "suppliers",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      name: varchar("name", { length: 255 }).notNull(),
      code: varchar("code", { length: 50 }),
      contactName: varchar("contact_name", { length: 255 }),
      email: varchar("email", { length: 255 }),
      phone: varchar("phone", { length: 50 }),
      billingLine1: varchar("billing_line1", { length: 255 }),
      billingLine2: varchar("billing_line2", { length: 255 }),
      billingCity: varchar("billing_city", { length: 120 }),
      billingRegion: varchar("billing_region", { length: 120 }),
      billingPostcode: varchar("billing_postcode", { length: 30 }),
      billingCountry: varchar("billing_country", { length: 120 }),
      xeroContactId: text("xero_contact_id"),
      paymentTerms: varchar("payment_terms", { length: 100 }),
      notes: text("notes"),
      deletedAt: timestamp("deleted_at"),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => [
      index("purchasing_suppliers_org_id_idx").on(table.organizationId),
      index("purchasing_suppliers_active_idx")
        .on(table.organizationId)
        .where(sql`deleted_at IS NULL`),
      index("purchasing_suppliers_name_idx").on(table.name),
      uniqueIndex("purchasing_suppliers_org_code_uidx")
        .on(table.organizationId, table.code)
        .where(sql`code IS NOT NULL AND deleted_at IS NULL`),
      pgPolicy("purchasing_suppliers_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const purchaseOrders = purchasingSchema
  .table(
    "purchase_orders",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      orderNumber: varchar("order_number", { length: 32 }).notNull(),
      supplierId: uuid("supplier_id")
        .notNull()
        .references(() => suppliers.id),
      supplierName: varchar("supplier_name", { length: 255 }).notNull(),
      status: varchar("status", { length: 20 }).notNull().default("draft"),
      expectedDate: date("expected_date", { mode: "string" }),
      notes: text("notes"),
      totalAmount: numeric("total_amount", { precision: 12, scale: 4 })
        .notNull()
        .default("0"),
      orderedAt: timestamp("ordered_at"),
      receivedAt: timestamp("received_at"),
      cancelledAt: timestamp("cancelled_at"),
      xeroPurchaseOrderId: text("xero_purchase_order_id"),
      xeroPurchaseOrderNumber: varchar("xero_purchase_order_number", {
        length: 50,
      }),
      xeroPushStatus: varchar("xero_push_status", { length: 20 }),
      xeroPushError: text("xero_push_error"),
      xeroPushedAt: timestamp("xero_pushed_at"),
      xeroPushPayloadHash: text("xero_push_payload_hash"),
      xeroLastPushAttemptAt: timestamp("xero_last_push_attempt_at"),
      xeroRetryCount: integer("xero_retry_count").notNull().default(0),
      deletedAt: timestamp("deleted_at"),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => [
      index("purchase_orders_org_id_idx").on(table.organizationId),
      index("purchase_orders_active_idx")
        .on(table.organizationId)
        .where(sql`deleted_at IS NULL`),
      index("purchase_orders_status_idx").on(table.status),
      index("purchase_orders_supplier_id_idx").on(table.supplierId),
      index("purchase_orders_expected_date_idx").on(table.expectedDate),
      index("purchase_orders_created_at_idx").on(table.createdAt),
      uniqueIndex("purchase_orders_org_order_number_uidx").on(
        table.organizationId,
        table.orderNumber
      ),
      pgPolicy("purchase_orders_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const purchaseOrderLines = purchasingSchema
  .table(
    "purchase_order_lines",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      purchaseOrderId: uuid("purchase_order_id")
        .notNull()
        .references(() => purchaseOrders.id),
      itemId: uuid("item_id")
        .notNull()
        .references(() => items.id),
      itemName: varchar("item_name", { length: 255 }).notNull(),
      itemSku: varchar("item_sku", { length: 50 }),
      purchaseUnitName: varchar("purchase_unit_name", { length: 50 }).notNull(),
      stockingUnitName: varchar("stocking_unit_name", { length: 50 }).notNull(),
      purchaseToStockFactor: numeric("purchase_to_stock_factor", {
        precision: 12,
        scale: 4,
      }).notNull(),
      quantityOrdered: numeric("quantity_ordered", { precision: 12, scale: 4 })
        .notNull(),
      quantityReceived: numeric("quantity_received", { precision: 12, scale: 4 })
        .notNull()
        .default("0"),
      stockQuantityOrdered: numeric("stock_quantity_ordered", {
        precision: 12,
        scale: 4,
      }).notNull(),
      stockQuantityReceived: numeric("stock_quantity_received", {
        precision: 12,
        scale: 4,
      }).notNull()
        .default("0"),
      unitCost: numeric("unit_cost", { precision: 10, scale: 4 }).notNull(),
      stockUnitCost: numeric("stock_unit_cost", { precision: 18, scale: 6 }).notNull(),
      lineTotal: numeric("line_total", { precision: 12, scale: 4 }).notNull(),
      sortOrder: integer("sort_order").notNull().default(0),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => [
      index("purchase_order_lines_order_id_idx").on(table.purchaseOrderId),
      index("purchase_order_lines_item_id_idx").on(table.itemId),
      uniqueIndex("purchase_order_lines_order_item_uidx").on(
        table.purchaseOrderId,
        table.itemId
      ),
      pgPolicy("purchase_order_lines_org_isolation", {
        for: "all",
        to: "public",
        using: sql`purchase_order_id IN (
          SELECT id
          FROM purchasing.purchase_orders
          WHERE organization_id = current_setting('app.current_org_id', true)
        )`,
        withCheck: sql`purchase_order_id IN (
          SELECT id
          FROM purchasing.purchase_orders
          WHERE organization_id = current_setting('app.current_org_id', true)
        )`,
      }),
    ]
  )
  .enableRLS();
