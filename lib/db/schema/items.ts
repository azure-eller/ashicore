import {
  type AnyPgColumn,
  integer,
  uuid,
  varchar,
  text,
  numeric,
  timestamp,
  boolean,
  check,
  pgPolicy,
  index,
  primaryKey,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { inventorySchema, unitDefinitions } from "./units";

export const itemFamilies = inventorySchema
  .table(
    "item_families",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      itemType: varchar("item_type", { length: 20 }).notNull(),
      name: varchar("name", { length: 255 }).notNull(),
      category: varchar("category", { length: 100 }),
      description: text("description"),
      unitDefinitionId: uuid("unit_definition_id")
        .notNull()
        .references(() => unitDefinitions.id),
      defaultSupplierId: uuid("default_supplier_id"),
      purchaseUnitDefinitionId: uuid("purchase_unit_definition_id").references(
        () => unitDefinitions.id
      ),
      purchaseToStockFactor: numeric("purchase_to_stock_factor", {
        precision: 12,
        scale: 4,
      }),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("item_families_org_id_idx").on(table.organizationId),
      index("item_families_active_idx")
        .on(table.organizationId)
        .where(sql`deleted_at IS NULL`),
      index("item_families_default_supplier_id_idx").on(table.defaultSupplierId),
      check("item_families_item_type_check", sql`item_type IN ('product', 'material')`),
      pgPolicy("item_families_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const variantOptions = inventorySchema
  .table(
    "variant_options",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      familyId: uuid("family_id")
        .notNull()
        .references(() => itemFamilies.id, { onDelete: "cascade" }),
      name: varchar("name", { length: 100 }).notNull(),
      code: varchar("code", { length: 100 }).notNull(),
      sortOrder: integer("sort_order").notNull().default(0),
      disabledAt: timestamp("disabled_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("variant_options_org_id_idx").on(table.organizationId),
      index("variant_options_family_id_idx").on(table.familyId),
      uniqueIndex("variant_options_family_code_uidx").on(table.familyId, table.code),
      uniqueIndex("variant_options_family_sort_order_uidx").on(
        table.familyId,
        table.sortOrder
      ),
      pgPolicy("variant_options_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const variantOptionValues = inventorySchema
  .table(
    "variant_option_values",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      optionId: uuid("option_id")
        .notNull()
        .references(() => variantOptions.id, { onDelete: "cascade" }),
      label: varchar("label", { length: 100 }).notNull(),
      code: varchar("code", { length: 100 }).notNull(),
      sortOrder: integer("sort_order").notNull().default(0),
      disabledAt: timestamp("disabled_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("variant_option_values_org_id_idx").on(table.organizationId),
      index("variant_option_values_option_id_idx").on(table.optionId),
      uniqueIndex("variant_option_values_option_code_uidx").on(
        table.optionId,
        table.code
      ),
      uniqueIndex("variant_option_values_option_sort_order_uidx").on(
        table.optionId,
        table.sortOrder
      ),
      pgPolicy("variant_option_values_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

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
        .references(() => unitDefinitions.id),
      purchaseUnitDefinitionId: uuid("purchase_unit_definition_id").references(
        () => unitDefinitions.id
      ),
      purchaseToStockFactor: numeric("purchase_to_stock_factor", {
        precision: 12,
        scale: 4,
      }),

      // Stock
      safetyStock: numeric("safety_stock", { precision: 12, scale: 4 }).notNull().default("0"),

      // Pricing
      defaultPurchasePrice: numeric("default_purchase_price", { precision: 10, scale: 4 }),
      currentStockUnitCost: numeric("current_stock_unit_cost", {
        precision: 18,
        scale: 6,
      }),
      defaultSellingPrice: numeric("default_selling_price", { precision: 10, scale: 2 }),
      sellable: boolean("sellable"),

      // Manufacturing
      manufacturingMode: varchar("manufacturing_mode", { length: 20 }).notNull().default("discrete"),
      expectedBatchYield: numeric("expected_batch_yield", { precision: 12, scale: 4 }),
      typicalBatchSize: numeric("typical_batch_size", { precision: 12, scale: 4 }),
      standardCostQuantity: numeric("standard_cost_quantity", {
        precision: 12,
        scale: 4,
      }),

      // Variant family
      familyId: uuid("family_id").references(() => itemFamilies.id, { onDelete: "restrict" }),
      optionCombinationKey: text("option_combination_key").notNull().default(""),
      isMaster: boolean("is_master").notNull().default(false),
      parentId: uuid("parent_id").references((): AnyPgColumn => items.id, { onDelete: "restrict" }),
      variantAxes: jsonb("variant_axes").$type<string[]>(),
      variantAttrs: jsonb("variant_attrs").$type<Record<string, string>>(),
      sortOrder: integer("sort_order").notNull().default(0),

      registeredBarcode: varchar("registered_barcode", { length: 100 }),
      internalBarcode: varchar("internal_barcode", { length: 100 }),
      supplierItemCode: varchar("supplier_item_code", { length: 100 }),
      defaultLeadTimeDays: integer("default_lead_time_days"),
      minimumOrderQuantity: numeric("minimum_order_quantity", {
        precision: 12,
        scale: 4,
      }),

      // BOM lock
      bomLocked: boolean("bom_locked").notNull().default(false),
      bomLockedAt: timestamp("bom_locked_at", { withTimezone: true }),
      bomLockedByUserId: text("bom_locked_by_user_id"),

      // Soft delete
      deletedAt: timestamp("deleted_at", { withTimezone: true }),

      // Timestamps
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("items_org_id_idx").on(table.organizationId),
      index("items_active_idx")
        .on(table.organizationId)
        .where(sql`deleted_at IS NULL`),
      uniqueIndex("items_org_sku_uidx")
        .on(table.organizationId, table.sku)
        .where(sql`sku IS NOT NULL AND deleted_at IS NULL`),
      index("items_parent_id_idx")
        .on(table.parentId)
        .where(sql`parent_id IS NOT NULL`),
      index("items_family_id_idx")
        .on(table.familyId)
        .where(sql`family_id IS NOT NULL`),
      index("items_family_sort_order_idx")
        .on(table.familyId, table.sortOrder)
        .where(sql`family_id IS NOT NULL`),
      index("items_option_combination_key_idx").on(table.optionCombinationKey),
      uniqueIndex("items_org_parent_variant_attrs_uidx")
        .on(table.organizationId, table.parentId, table.variantAttrs)
        .where(sql`parent_id IS NOT NULL AND deleted_at IS NULL`),
      check("items_no_self_parent", sql`parent_id != id`),
      check("items_products_only_variants", sql`parent_id IS NULL OR item_type = 'product'`),
      check("items_products_only_masters", sql`is_master = false OR item_type = 'product'`),
      check("items_variants_not_masters", sql`parent_id IS NULL OR is_master = false`),
      check("items_non_master_needs_unit", sql`is_master = true OR unit_definition_id IS NOT NULL`),
      check("items_master_sellable_must_be_null", sql`is_master = false OR sellable IS NULL`),
      check("items_non_master_sellable_required", sql`is_master = true OR sellable IS NOT NULL`),
      check("items_variant_attrs_needs_parent", sql`variant_attrs IS NULL OR parent_id IS NOT NULL`),
      check("items_variant_axes_needs_master", sql`variant_axes IS NULL OR is_master = true`),
      check(
        "items_default_lead_time_days_nonnegative",
        sql`default_lead_time_days IS NULL OR default_lead_time_days >= 0`
      ),
      check(
        "items_minimum_order_quantity_positive",
        sql`minimum_order_quantity IS NULL OR minimum_order_quantity > 0`
      ),
      check(
        "items_typical_batch_size_positive",
        sql`typical_batch_size IS NULL OR typical_batch_size > 0`
      ),
      check(
        "items_standard_cost_quantity_positive",
        sql`standard_cost_quantity IS NULL OR standard_cost_quantity > 0`
      ),
      pgPolicy("items_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const itemVariantValues = inventorySchema
  .table(
    "item_variant_values",
    {
      organizationId: text("organization_id").notNull(),
      itemId: uuid("item_id")
        .notNull()
        .references(() => items.id, { onDelete: "cascade" }),
      optionId: uuid("option_id")
        .notNull()
        .references(() => variantOptions.id, { onDelete: "restrict" }),
      optionValueId: uuid("option_value_id")
        .notNull()
        .references(() => variantOptionValues.id, { onDelete: "restrict" }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      primaryKey({ columns: [table.itemId, table.optionId] }),
      index("item_variant_values_org_id_idx").on(table.organizationId),
      index("item_variant_values_option_value_id_idx").on(table.optionValueId),
      pgPolicy("item_variant_values_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();
