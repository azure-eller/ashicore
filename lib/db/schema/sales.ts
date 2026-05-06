import {
  boolean,
  check,
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
import { unitDefinitions } from "./units";

export const salesSchema = pgSchema("sales");

export const customerCategories = salesSchema
  .table(
    "customer_categories",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      name: varchar("name", { length: 100 }).notNull(),
      description: text("description"),
      sortOrder: integer("sort_order").notNull().default(0),
      deletedAt: timestamp("deleted_at"),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => [
      index("sales_customer_categories_org_id_idx").on(table.organizationId),
      index("sales_customer_categories_active_idx")
        .on(table.organizationId)
        .where(sql`deleted_at IS NULL`),
      index("sales_customer_categories_name_idx").on(table.name),
      uniqueIndex("sales_customer_categories_org_name_uidx")
        .on(table.organizationId, table.name)
        .where(sql`deleted_at IS NULL`),
      pgPolicy("sales_customer_categories_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const customers = salesSchema
  .table(
    "customers",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      name: varchar("name", { length: 255 }).notNull(),
      customerCategoryId: uuid("customer_category_id").references(
        () => customerCategories.id
      ),
      email: varchar("email", { length: 255 }),
      phone: varchar("phone", { length: 50 }),
      billingLine1: varchar("billing_line1", { length: 255 }),
      billingLine2: varchar("billing_line2", { length: 255 }),
      billingCity: varchar("billing_city", { length: 120 }),
      billingRegion: varchar("billing_region", { length: 120 }),
      billingPostcode: varchar("billing_postcode", { length: 30 }),
      billingCountry: varchar("billing_country", { length: 120 }),
      shipLine1: varchar("ship_line1", { length: 255 }),
      shipLine2: varchar("ship_line2", { length: 255 }),
      shipCity: varchar("ship_city", { length: 120 }),
      shipRegion: varchar("ship_region", { length: 120 }),
      shipPostcode: varchar("ship_postcode", { length: 30 }),
      shipCountry: varchar("ship_country", { length: 120 }),
      xeroContactId: text("xero_contact_id"),
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
      index("sales_customers_customer_category_id_idx").on(table.customerCategoryId),
      pgPolicy("sales_customers_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const pricingSchedules = salesSchema
  .table(
    "pricing_schedules",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      name: varchar("name", { length: 255 }).notNull(),
      customerCategoryId: uuid("customer_category_id").references(
        () => customerCategories.id
      ),
      unitDefinitionId: uuid("unit_definition_id")
        .notNull()
        .references(() => unitDefinitions.id),
      notes: text("notes"),
      deletedAt: timestamp("deleted_at"),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => [
      index("sales_pricing_schedules_org_id_idx").on(table.organizationId),
      index("sales_pricing_schedules_active_idx")
        .on(table.organizationId)
        .where(sql`deleted_at IS NULL`),
      index("sales_pricing_schedules_customer_category_id_idx").on(
        table.customerCategoryId
      ),
      index("sales_pricing_schedules_unit_definition_id_idx").on(
        table.unitDefinitionId
      ),
      uniqueIndex("sales_pricing_schedules_scope_uidx")
        .on(table.organizationId, table.customerCategoryId, table.unitDefinitionId)
        .where(sql`customer_category_id IS NOT NULL AND deleted_at IS NULL`),
      uniqueIndex("sales_pricing_schedules_everyone_uidx")
        .on(table.organizationId, table.unitDefinitionId)
        .where(sql`customer_category_id IS NULL AND deleted_at IS NULL`),
      pgPolicy("sales_pricing_schedules_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const pricingScheduleBreaks = salesSchema
  .table(
    "pricing_schedule_breaks",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      pricingScheduleId: uuid("pricing_schedule_id")
        .notNull()
        .references(() => pricingSchedules.id, { onDelete: "cascade" }),
      minQuantity: numeric("min_quantity", { precision: 12, scale: 4 }).notNull(),
      maxQuantity: numeric("max_quantity", { precision: 12, scale: 4 }),
      discountPercent: numeric("discount_percent", {
        precision: 5,
        scale: 2,
      }).notNull(),
      sortOrder: integer("sort_order").notNull().default(0),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => [
      index("sales_pricing_schedule_breaks_schedule_id_idx").on(
        table.pricingScheduleId
      ),
      uniqueIndex("sales_pricing_schedule_breaks_schedule_sort_uidx").on(
        table.pricingScheduleId,
        table.sortOrder
      ),
      pgPolicy("sales_pricing_schedule_breaks_org_isolation", {
        for: "all",
        to: "public",
        using: sql`pricing_schedule_id IN (
          SELECT id
          FROM sales.pricing_schedules
          WHERE organization_id = current_setting('app.current_org_id', true)
        )`,
        withCheck: sql`pricing_schedule_id IN (
          SELECT id
          FROM sales.pricing_schedules
          WHERE organization_id = current_setting('app.current_org_id', true)
        )`,
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
      orderDate: date("order_date", { mode: "string" })
        .notNull()
        .default(sql`CURRENT_DATE`),
      shipDate: date("ship_date", { mode: "string" }),
      requestedDate: date("requested_date", { mode: "string" }),
      notes: text("notes"),
      shippedAt: timestamp("shipped_at"),
      shipLine1: varchar("ship_line1", { length: 255 }),
      shipLine2: varchar("ship_line2", { length: 255 }),
      shipCity: varchar("ship_city", { length: 120 }),
      shipRegion: varchar("ship_region", { length: 120 }),
      shipPostcode: varchar("ship_postcode", { length: 30 }),
      shipCountry: varchar("ship_country", { length: 120 }),
      xeroInvoiceId: text("xero_invoice_id"),
      xeroInvoiceNumber: varchar("xero_invoice_number", { length: 50 }),
      xeroPushStatus: varchar("xero_push_status", { length: 20 }),
      xeroPushError: text("xero_push_error"),
      xeroPushedAt: timestamp("xero_pushed_at"),
      xeroPushPayloadHash: text("xero_push_payload_hash"),
      xeroLastPushAttemptAt: timestamp("xero_last_push_attempt_at"),
      xeroRetryCount: integer("xero_retry_count").notNull().default(0),
      xeroEmailStatus: varchar("xero_email_status", { length: 20 }),
      xeroEmailError: text("xero_email_error"),
      xeroEmailedAt: timestamp("xero_emailed_at"),
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
      index("sales_orders_order_date_idx").on(table.orderDate),
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
      cancelledQuantity: numeric("cancelled_quantity", {
        precision: 12,
        scale: 4,
      })
        .notNull()
        .default("0"),
      unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
      suggestedUnitPrice: numeric("suggested_unit_price", {
        precision: 10,
        scale: 2,
      }),
      pricingSourceType: varchar("pricing_source_type", { length: 30 }),
      pricingScheduleName: varchar("pricing_schedule_name", { length: 255 }),
      pricingBreakLabel: varchar("pricing_break_label", { length: 50 }),
      isPriceOverridden: boolean("is_price_overridden").notNull().default(false),
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
      check(
        "sales_order_lines_cancelled_quantity_check",
        sql`cancelled_quantity >= 0 AND cancelled_quantity <= quantity`
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

export const salesShipments = salesSchema
  .table(
    "sales_shipments",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      salesOrderId: uuid("sales_order_id")
        .notNull()
        .references(() => salesOrders.id),
      shipmentNumber: varchar("shipment_number", { length: 50 }).notNull(),
      sequence: integer("sequence").notNull(),
      status: varchar("status", { length: 20 }).notNull().default("draft"),
      fulfillmentType: varchar("fulfillment_type", { length: 20 })
        .notNull()
        .default("delivery"),
      scheduledDate: date("scheduled_date", { mode: "string" }),
      shippedAt: timestamp("shipped_at"),
      notes: text("notes"),
      customerFreightChargeAmount: numeric("customer_freight_charge_amount", {
        precision: 12,
        scale: 2,
      }),
      orderNumber: varchar("order_number", { length: 32 }).notNull(),
      customerName: varchar("customer_name", { length: 255 }).notNull(),
      shipLine1: varchar("ship_line1", { length: 255 }),
      shipLine2: varchar("ship_line2", { length: 255 }),
      shipCity: varchar("ship_city", { length: 120 }),
      shipRegion: varchar("ship_region", { length: 120 }),
      shipPostcode: varchar("ship_postcode", { length: 30 }),
      shipCountry: varchar("ship_country", { length: 120 }),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => [
      index("sales_shipments_org_id_idx").on(table.organizationId),
      index("sales_shipments_order_id_idx").on(table.salesOrderId),
      index("sales_shipments_status_idx").on(table.status),
      uniqueIndex("sales_shipments_org_number_uidx").on(
        table.organizationId,
        table.shipmentNumber
      ),
      uniqueIndex("sales_shipments_order_sequence_uidx").on(
        table.salesOrderId,
        table.sequence
      ),
      check(
        "sales_shipments_status_check",
        sql`status IN ('draft', 'shipped', 'cancelled')`
      ),
      check(
        "sales_shipments_fulfillment_type_check",
        sql`fulfillment_type IN ('delivery', 'pickup')`
      ),
      check(
        "sales_shipments_shipped_at_check",
        sql`(status = 'shipped' AND shipped_at IS NOT NULL) OR (status <> 'shipped' AND shipped_at IS NULL)`
      ),
      pgPolicy("sales_shipments_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const salesShipmentCosts = salesSchema
  .table(
    "sales_shipment_costs",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      salesShipmentId: uuid("sales_shipment_id")
        .notNull()
        .references(() => salesShipments.id, { onDelete: "cascade" }),
      costType: varchar("cost_type", { length: 30 }).notNull(),
      costStatus: varchar("cost_status", { length: 20 }).notNull(),
      amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
      vendorName: varchar("vendor_name", { length: 255 }),
      referenceNumber: varchar("reference_number", { length: 120 }),
      incurredDate: date("incurred_date", { mode: "string" }),
      notes: text("notes"),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => [
      index("sales_shipment_costs_org_id_idx").on(table.organizationId),
      index("sales_shipment_costs_shipment_id_idx").on(table.salesShipmentId),
      index("sales_shipment_costs_status_idx").on(table.organizationId, table.costStatus),
      check(
        "sales_shipment_costs_type_check",
        sql`cost_type IN ('freight', 'delivery_labor', 'fuel', 'packaging', 'accessorial', 'other')`
      ),
      check(
        "sales_shipment_costs_status_check",
        sql`cost_status IN ('estimated', 'actual')`
      ),
      check("sales_shipment_costs_amount_check", sql`amount > 0`),
      pgPolicy("sales_shipment_costs_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const salesShipmentLines = salesSchema
  .table(
    "sales_shipment_lines",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      salesShipmentId: uuid("sales_shipment_id")
        .notNull()
        .references(() => salesShipments.id),
      salesOrderLineId: uuid("sales_order_line_id")
        .notNull()
        .references(() => salesOrderLines.id),
      itemId: uuid("item_id")
        .notNull()
        .references(() => items.id),
      itemName: varchar("item_name", { length: 255 }).notNull(),
      itemSku: varchar("item_sku", { length: 50 }),
      unitName: varchar("unit_name", { length: 50 }).notNull(),
      quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull(),
      sortOrder: integer("sort_order").notNull().default(0),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => [
      index("sales_shipment_lines_shipment_id_idx").on(table.salesShipmentId),
      index("sales_shipment_lines_order_line_id_idx").on(table.salesOrderLineId),
      uniqueIndex("sales_shipment_lines_shipment_line_uidx").on(
        table.salesShipmentId,
        table.salesOrderLineId
      ),
      check("sales_shipment_lines_quantity_check", sql`quantity > 0`),
      pgPolicy("sales_shipment_lines_org_isolation", {
        for: "all",
        to: "public",
        using: sql`sales_shipment_id IN (
          SELECT id
          FROM sales.sales_shipments
          WHERE organization_id = current_setting('app.current_org_id', true)
        )`,
        withCheck: sql`sales_shipment_id IN (
          SELECT id
          FROM sales.sales_shipments
          WHERE organization_id = current_setting('app.current_org_id', true)
        )`,
      }),
    ]
  )
  .enableRLS();
