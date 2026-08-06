import {
  date,
  foreignKey,
  index,
  integer,
  numeric,
  boolean,
  check,
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
import { addressEntries } from "./addresses";
import { taxRates } from "./tax-settings";

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
      paymentTerms: varchar("payment_terms", { length: 100 }),
      notes: text("notes"),
      version: integer("version").notNull().default(1),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
      uniqueIndex("purchasing_suppliers_org_id_uidx").on(
        table.organizationId,
        table.id
      ),
      pgPolicy("purchasing_suppliers_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const supplierItems = purchasingSchema
  .table(
    "supplier_items",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      supplierId: uuid("supplier_id")
        .notNull()
        .references(() => suppliers.id),
      itemId: uuid("item_id")
        .notNull()
        .references(() => items.id),
      supplierSku: varchar("supplier_sku", { length: 100 }),
      unitCost: numeric("unit_cost", { precision: 10, scale: 4 }),
      purchaseUnitDefinitionId: uuid("purchase_unit_definition_id").references(
        () => unitDefinitions.id
      ),
      purchaseToStockFactor: numeric("purchase_to_stock_factor", {
        precision: 12,
        scale: 4,
      }),
      isPreferred: boolean("is_preferred").notNull().default(false),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("supplier_items_org_id_idx").on(table.organizationId),
      index("supplier_items_supplier_id_idx").on(table.supplierId),
      index("supplier_items_item_id_idx").on(table.itemId),
      index("supplier_items_active_idx")
        .on(table.organizationId)
        .where(sql`deleted_at IS NULL`),
      uniqueIndex("supplier_items_org_supplier_item_uidx")
        .on(table.organizationId, table.supplierId, table.itemId)
        .where(sql`deleted_at IS NULL`),
      uniqueIndex("supplier_items_org_preferred_item_uidx")
        .on(table.organizationId, table.itemId)
        .where(sql`deleted_at IS NULL AND is_preferred = true`),
      pgPolicy("supplier_items_org_isolation", {
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
      parentPurchaseOrderId: uuid("parent_purchase_order_id"),
      type: varchar("type", { length: 20 }).notNull().default("standard"),
      supplierId: uuid("supplier_id")
        .notNull()
        .references(() => suppliers.id),
      supplierName: varchar("supplier_name", { length: 255 }).notNull(),
      status: varchar("status", { length: 20 }).notNull().default("not_received"),
      purchaseBillManualStatus: varchar("purchase_bill_manual_status", {
        length: 20,
      }),
      expectedDate: date("expected_date", { mode: "string" }),
      notes: text("notes"),
      accountingPurchaseAccountCode: varchar("accounting_purchase_account_code", {
        length: 20,
      }),
      shipContactName: varchar("ship_contact_name", { length: 255 }),
      shipContactPhone: varchar("ship_contact_phone", { length: 50 }),
      shipLine1: varchar("ship_line1", { length: 255 }),
      shipLine2: varchar("ship_line2", { length: 255 }),
      shipCity: varchar("ship_city", { length: 120 }),
      shipRegion: varchar("ship_region", { length: 120 }),
      shipPostcode: varchar("ship_postcode", { length: 30 }),
      shipCountry: varchar("ship_country", { length: 120 }),
      shippingCost: numeric("shipping_cost", { precision: 12, scale: 4 })
        .notNull()
        .default("0"),
      subtotalAmount: numeric("subtotal_amount", { precision: 12, scale: 4 })
        .notNull()
        .default("0"),
      taxAmount: numeric("tax_amount", { precision: 12, scale: 4 })
        .notNull()
        .default("0"),
      totalAmount: numeric("total_amount", { precision: 12, scale: 4 })
        .notNull()
        .default("0"),
      orderedAt: timestamp("ordered_at", { withTimezone: true }),
      receivedAt: timestamp("received_at", { withTimezone: true }),
      cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
      version: integer("version").notNull().default(1),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("purchase_orders_org_id_idx").on(table.organizationId),
      index("purchase_orders_active_idx")
        .on(table.organizationId)
        .where(sql`deleted_at IS NULL`),
      index("purchase_orders_status_idx").on(table.status),
      index("purchase_orders_supplier_id_idx").on(table.supplierId),
      index("purchase_orders_parent_id_idx").on(table.parentPurchaseOrderId),
      index("purchase_orders_expected_date_idx").on(table.expectedDate),
      index("purchase_orders_created_at_idx").on(table.createdAt),
      uniqueIndex("purchase_orders_org_order_number_uidx").on(
        table.organizationId,
        table.orderNumber
      ),
      uniqueIndex("purchase_orders_org_id_uidx").on(
        table.organizationId,
        table.id
      ),
      uniqueIndex("purchase_orders_org_parent_additional_cost_supplier_uidx")
        .on(table.organizationId, table.parentPurchaseOrderId, table.supplierId)
        .where(sql`type = 'additional_cost' AND deleted_at IS NULL`),
      check(
        "purchase_orders_type_check",
        sql`type IN ('standard', 'additional_cost')`
      ),
      check(
        "purchase_orders_status_check",
        sql`status IN ('not_received', 'partial', 'received')`
      ),
      check(
        "purchase_orders_purchase_bill_manual_status_check",
        sql`purchase_bill_manual_status IS NULL OR purchase_bill_manual_status IN ('not_billed', 'partly_billed', 'billed')`
      ),
      check(
        "purchase_orders_parent_type_check",
        sql`(type = 'standard' AND parent_purchase_order_id IS NULL) OR (type = 'additional_cost' AND parent_purchase_order_id IS NOT NULL)`
      ),
      foreignKey({
        columns: [table.parentPurchaseOrderId],
        foreignColumns: [table.id],
        name: "purchase_orders_parent_id_fk",
      }),
      foreignKey({
        columns: [table.organizationId, table.parentPurchaseOrderId],
        foreignColumns: [table.organizationId, table.id],
        name: "purchase_orders_parent_org_id_fk",
      }),
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
      itemName: text("item_name").notNull(),
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
      // Short-close: the ordered balance the operator declared is never arriving.
      // Kept alongside quantityOrdered so the order still records what was ordered
      // versus what actually showed up. Status counts received + closed.
      quantityClosed: numeric("quantity_closed", { precision: 12, scale: 4 })
        .notNull()
        .default("0"),
      stockQuantityClosed: numeric("stock_quantity_closed", {
        precision: 12,
        scale: 4,
      })
        .notNull()
        .default("0"),
      unitCost: numeric("unit_cost", { precision: 10, scale: 4 }).notNull(),
      stockUnitCost: numeric("stock_unit_cost", { precision: 18, scale: 6 }).notNull(),
      taxRateId: uuid("tax_rate_id").references(() => taxRates.id, {
        onDelete: "set null",
      }),
      taxRateName: varchar("tax_rate_name", { length: 120 }),
      taxRatePercent: numeric("tax_rate_percent", {
        precision: 7,
        scale: 4,
      })
        .notNull()
        .default("0"),
      accountingPurchaseAccountCode: varchar("accounting_purchase_account_code", {
        length: 20,
      }),
      shipAddressEntryId: uuid("ship_address_entry_id").references(
        () => addressEntries.id,
        { onDelete: "set null" }
      ),
      shipContactName: varchar("ship_contact_name", { length: 255 }),
      shipContactPhone: varchar("ship_contact_phone", { length: 50 }),
      shipLine1: varchar("ship_line1", { length: 255 }),
      shipLine2: varchar("ship_line2", { length: 255 }),
      shipCity: varchar("ship_city", { length: 120 }),
      shipRegion: varchar("ship_region", { length: 120 }),
      shipPostcode: varchar("ship_postcode", { length: 30 }),
      shipCountry: varchar("ship_country", { length: 120 }),
      shipDeliveryInstructions: text("ship_delivery_instructions"),
      lineSubtotal: numeric("line_subtotal", { precision: 12, scale: 4 })
        .notNull()
        .default("0"),
      lineTaxAmount: numeric("line_tax_amount", { precision: 12, scale: 4 })
        .notNull()
        .default("0"),
      lineTotal: numeric("line_total", { precision: 12, scale: 4 }).notNull(),
      sortOrder: integer("sort_order").notNull().default(0),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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

export const purchaseOrderAdditionalCosts = purchasingSchema
  .table(
    "purchase_order_additional_costs",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      purchaseOrderId: uuid("purchase_order_id")
        .notNull()
        .references(() => purchaseOrders.id, { onDelete: "cascade" }),
      supplierId: uuid("supplier_id").references(
        () => suppliers.id,
        { onDelete: "set null" }
      ),
      costType: varchar("cost_type", { length: 20 }).notNull(),
      reference: varchar("reference", { length: 120 }),
      distributionMethod: varchar("distribution_method", { length: 20 }).notNull(),
      accountingPurchaseAccountCode: varchar("accounting_purchase_account_code", {
        length: 20,
      }),
      amount: numeric("amount", { precision: 12, scale: 4 }).notNull(),
      sortOrder: integer("sort_order").notNull().default(0),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("purchase_order_additional_costs_org_id_idx").on(table.organizationId),
      index("purchase_order_additional_costs_order_id_idx").on(table.purchaseOrderId),
      index("purchase_order_additional_costs_supplier_id_idx").on(
        table.supplierId
      ),
      check(
        "purchase_order_additional_costs_type_check",
        sql`cost_type IN ('shipping', 'customs', 'other')`
      ),
      check(
        "purchase_order_additional_costs_distribution_check",
        sql`distribution_method IN ('by_value', 'by_quantity', 'not_distributed')`
      ),
      check("purchase_order_additional_costs_amount_check", sql`amount >= 0`),
      foreignKey({
        columns: [table.organizationId, table.supplierId],
        foreignColumns: [suppliers.organizationId, suppliers.id],
        name: "purchase_order_additional_costs_supplier_org_fk",
      }),
      pgPolicy("purchase_order_additional_costs_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();
