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
import { addressEntries } from "./addresses";
import { items } from "./items";

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
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
      accountState: varchar("account_state", { length: 20 })
        .notNull()
        .default("active"),
      accountPriority: varchar("account_priority", { length: 20 })
        .notNull()
        .default("standard"),
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
      notes: text("notes"),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("sales_customers_org_id_idx").on(table.organizationId),
      index("sales_customers_active_idx")
        .on(table.organizationId)
        .where(sql`deleted_at IS NULL`),
      index("sales_customers_name_idx").on(table.name),
      index("sales_customers_customer_category_id_idx").on(table.customerCategoryId),
      index("sales_customers_account_state_idx").on(table.accountState),
      index("sales_customers_account_priority_idx").on(table.accountPriority),
      check(
        "sales_customers_account_state_check",
        sql`${table.accountState} IN ('active', 'growth', 'at_risk', 'former')`
      ),
      check(
        "sales_customers_account_priority_check",
        sql`${table.accountPriority} IN ('strategic', 'high', 'standard', 'low')`
      ),
      pgPolicy("sales_customers_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const customerContacts = salesSchema
  .table(
    "customer_contacts",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      customerId: uuid("customer_id")
        .notNull()
        .references(() => customers.id),
      name: varchar("name", { length: 255 }).notNull(),
      title: varchar("title", { length: 255 }),
      email: varchar("email", { length: 255 }),
      phone: varchar("phone", { length: 50 }),
      addressEntryId: uuid("address_entry_id").references(() => addressEntries.id),
      isPrimary: boolean("is_primary").notNull().default(false),
      receivesShipping: boolean("receives_shipping").notNull().default(false),
      receivesInvoices: boolean("receives_invoices").notNull().default(false),
      receivesBillingCc: boolean("receives_billing_cc").notNull().default(false),
      isOnSite: boolean("is_on_site").notNull().default(false),
      notes: text("notes"),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("sales_customer_contacts_org_id_idx").on(table.organizationId),
      index("sales_customer_contacts_customer_id_idx").on(table.customerId),
      index("sales_customer_contacts_address_entry_id_idx").on(table.addressEntryId),
      index("sales_customer_contacts_active_idx")
        .on(table.organizationId, table.customerId)
        .where(sql`deleted_at IS NULL`),
      pgPolicy("sales_customer_contacts_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const customerCorrespondence = salesSchema
  .table(
    "customer_correspondence",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      customerId: uuid("customer_id")
        .notNull()
        .references(() => customers.id),
      type: varchar("type", { length: 20 }).notNull(),
      occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
      title: varchar("title", { length: 255 }),
      body: text("body").notNull(),
      createdByUserId: text("created_by_user_id").notNull(),
      createdByName: varchar("created_by_name", { length: 255 }),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("sales_customer_correspondence_org_id_idx").on(table.organizationId),
      index("sales_customer_correspondence_customer_id_idx").on(table.customerId),
      index("sales_customer_correspondence_occurred_at_idx").on(table.occurredAt),
      check(
        "sales_customer_correspondence_type_check",
        sql`${table.type} IN ('note', 'call', 'email', 'meeting')`
      ),
      pgPolicy("sales_customer_correspondence_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const customerCorrespondenceAttendees = salesSchema
  .table(
    "customer_correspondence_attendees",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      customerId: uuid("customer_id")
        .notNull()
        .references(() => customers.id),
      correspondenceId: uuid("correspondence_id")
        .notNull()
        .references(() => customerCorrespondence.id, { onDelete: "cascade" }),
      contactId: uuid("contact_id").references(() => customerContacts.id),
      contactName: varchar("contact_name", { length: 255 }).notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("sales_customer_correspondence_attendees_org_id_idx").on(
        table.organizationId
      ),
      index("sales_customer_correspondence_attendees_correspondence_id_idx").on(
        table.correspondenceId
      ),
      index("sales_customer_correspondence_attendees_contact_id_idx").on(
        table.contactId
      ),
      pgPolicy("sales_customer_correspondence_attendees_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const customerProjects = salesSchema
  .table(
    "customer_projects",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      customerId: uuid("customer_id")
        .notNull()
        .references(() => customers.id),
      name: varchar("name", { length: 255 }).notNull(),
      status: varchar("status", { length: 20 }).notNull().default("planning"),
      startDate: date("start_date", { mode: "string" }),
      targetEndDate: date("target_end_date", { mode: "string" }),
      summary: text("summary"),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("sales_customer_projects_org_id_idx").on(table.organizationId),
      index("sales_customer_projects_customer_id_idx").on(table.customerId),
      index("sales_customer_projects_active_idx")
        .on(table.organizationId, table.customerId)
        .where(sql`deleted_at IS NULL`),
      check(
        "sales_customer_projects_status_check",
        sql`${table.status} IN ('planning', 'active', 'hold', 'done')`
      ),
      pgPolicy("sales_customer_projects_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const customerProjectFiles = salesSchema
  .table(
    "customer_project_files",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      customerId: uuid("customer_id")
        .notNull()
        .references(() => customers.id),
      projectId: uuid("project_id")
        .notNull()
        .references(() => customerProjects.id),
      storageKey: text("storage_key").notNull(),
      blobUrl: text("blob_url").notNull(),
      filename: varchar("filename", { length: 255 }).notNull(),
      contentType: varchar("content_type", { length: 120 }).notNull(),
      sizeBytes: integer("size_bytes").notNull(),
      uploadedByUserId: text("uploaded_by_user_id").notNull(),
      uploadedByName: varchar("uploaded_by_name", { length: 255 }),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("sales_customer_project_files_org_id_idx").on(table.organizationId),
      index("sales_customer_project_files_project_id_idx").on(table.projectId),
      index("sales_customer_project_files_active_idx")
        .on(table.organizationId, table.projectId)
        .where(sql`deleted_at IS NULL`),
      uniqueIndex("sales_customer_project_files_storage_key_uidx").on(
        table.storageKey
      ),
      pgPolicy("sales_customer_project_files_org_isolation", {
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
      itemScope: varchar("item_scope", { length: 20 }).notNull().default("all"),
      notes: text("notes"),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("sales_pricing_schedules_org_id_idx").on(table.organizationId),
      index("sales_pricing_schedules_active_idx")
        .on(table.organizationId)
        .where(sql`deleted_at IS NULL`),
      index("sales_pricing_schedules_customer_category_id_idx").on(
        table.customerCategoryId
      ),
      uniqueIndex("sales_pricing_schedules_customer_all_items_uidx")
        .on(table.organizationId, table.customerCategoryId)
        .where(sql`customer_category_id IS NOT NULL AND item_scope = 'all' AND deleted_at IS NULL`),
      uniqueIndex("sales_pricing_schedules_all_customers_all_items_uidx")
        .on(table.organizationId)
        .where(sql`customer_category_id IS NULL AND item_scope = 'all' AND deleted_at IS NULL`),
      pgPolicy("sales_pricing_schedules_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const pricingScheduleItems = salesSchema
  .table(
    "pricing_schedule_items",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      pricingScheduleId: uuid("pricing_schedule_id")
        .notNull()
        .references(() => pricingSchedules.id, { onDelete: "cascade" }),
      customerCategoryId: uuid("customer_category_id").references(
        () => customerCategories.id
      ),
      itemId: uuid("item_id")
        .notNull()
        .references(() => items.id),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("sales_pricing_schedule_items_org_id_idx").on(table.organizationId),
      index("sales_pricing_schedule_items_schedule_id_idx").on(
        table.pricingScheduleId
      ),
      index("sales_pricing_schedule_items_item_id_idx").on(table.itemId),
      uniqueIndex("sales_pricing_schedule_items_schedule_item_uidx").on(
        table.pricingScheduleId,
        table.itemId
      ),
      pgPolicy("sales_pricing_schedule_items_org_isolation", {
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
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
      customerProjectId: uuid("customer_project_id").references(
        () => customerProjects.id
      ),
      customerName: varchar("customer_name", { length: 255 }).notNull(),
      status: varchar("status", { length: 20 }).notNull().default("open"),
      priorityRank: integer("priority_rank"),
      orderDate: date("order_date", { mode: "string" })
        .notNull()
        .default(sql`CURRENT_DATE`),
      shipDate: date("ship_date", { mode: "string" }),
      requestedDate: date("requested_date", { mode: "string" }),
      notes: text("notes"),
      shippedAt: timestamp("shipped_at", { withTimezone: true }),
      shipLine1: varchar("ship_line1", { length: 255 }),
      shipLine2: varchar("ship_line2", { length: 255 }),
      shipCity: varchar("ship_city", { length: 120 }),
      shipRegion: varchar("ship_region", { length: 120 }),
      shipPostcode: varchar("ship_postcode", { length: 30 }),
      shipCountry: varchar("ship_country", { length: 120 }),
      billingLine1: varchar("billing_line1", { length: 255 }),
      billingLine2: varchar("billing_line2", { length: 255 }),
      billingCity: varchar("billing_city", { length: 120 }),
      billingRegion: varchar("billing_region", { length: 120 }),
      billingPostcode: varchar("billing_postcode", { length: 30 }),
      billingCountry: varchar("billing_country", { length: 120 }),
      shippingFeeDescription: varchar("shipping_fee_description", { length: 255 }),
      shippingFeeAmount: numeric("shipping_fee_amount", {
        precision: 12,
        scale: 2,
      })
        .notNull()
        .default("0"),
      shippingFeeTaxAmount: numeric("shipping_fee_tax_amount", {
        precision: 12,
        scale: 2,
      })
        .notNull()
        .default("0"),
      totalAmount: numeric("total_amount", { precision: 12, scale: 2 })
        .notNull()
        .default("0"),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("sales_orders_org_id_idx").on(table.organizationId),
      index("sales_orders_active_idx")
        .on(table.organizationId)
        .where(sql`deleted_at IS NULL`),
      index("sales_orders_customer_id_idx").on(table.customerId),
      index("sales_orders_customer_project_id_idx").on(table.customerProjectId),
      index("sales_orders_status_idx").on(table.status),
      index("sales_orders_priority_rank_idx")
        .on(table.organizationId, table.status, table.priorityRank)
        .where(sql`deleted_at IS NULL AND priority_rank IS NOT NULL`),
      uniqueIndex("sales_orders_open_priority_rank_uidx")
        .on(table.organizationId, table.priorityRank)
        .where(
          sql`deleted_at IS NULL AND priority_rank IS NOT NULL AND status = 'open'`
        ),
      index("sales_orders_order_date_idx").on(table.orderDate),
      index("sales_orders_created_at_idx").on(table.createdAt),
      uniqueIndex("sales_orders_org_order_number_uidx").on(
        table.organizationId,
        table.orderNumber
      ),
      check("sales_orders_priority_rank_positive_check", sql`${table.priorityRank} > 0`),
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
      allocationManagedAt: timestamp("allocation_managed_at", {
        withTimezone: true,
      }),
      allocationManagedBy: text("allocation_managed_by"),
      sortOrder: integer("sort_order").notNull().default(0),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
      status: varchar("status", { length: 20 }).notNull().default("planned"),
      fulfillmentType: varchar("fulfillment_type", { length: 20 })
        .notNull()
        .default("delivery"),
      scheduledDate: date("scheduled_date", { mode: "string" }),
      deliveryDate: date("delivery_date", { mode: "string" }),
      shippedAt: timestamp("shipped_at", { withTimezone: true }),
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
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
        sql`status IN ('planned', 'shipped')`
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
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
