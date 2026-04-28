import {
  type AnyPgColumn,
  uuid,
  varchar,
  text,
  numeric,
  timestamp,
  boolean,
  check,
  pgPolicy,
  index,
  uniqueIndex,
  jsonb,
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
      reorderPoint: numeric("reorder_point", { precision: 12, scale: 4 }),
      targetCoverDays: numeric("target_cover_days", { precision: 8, scale: 2 }),
      planningEnabled: boolean("planning_enabled").notNull().default(true),
      leadTimeDaysOverride: numeric("lead_time_days_override", {
        precision: 8,
        scale: 2,
      }),

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
      productionLeadTimeDays: numeric("production_lead_time_days", {
        precision: 8,
        scale: 2,
      }),

      // Variant family
      isMaster: boolean("is_master").notNull().default(false),
      parentId: uuid("parent_id").references((): AnyPgColumn => items.id, { onDelete: "restrict" }),
      variantAxes: jsonb("variant_axes").$type<string[]>(),
      variantAttrs: jsonb("variant_attrs").$type<Record<string, string>>(),

      // BOM lock
      bomLocked: boolean("bom_locked").notNull().default(false),
      bomLockedAt: timestamp("bom_locked_at"),
      bomLockedByUserId: text("bom_locked_by_user_id"),

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
      index("items_parent_id_idx")
        .on(table.parentId)
        .where(sql`parent_id IS NOT NULL`),
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
      pgPolicy("items_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();
