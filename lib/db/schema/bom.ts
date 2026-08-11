import {
  type AnyPgColumn,
  uuid,
  numeric,
  timestamp,
  check,
  pgPolicy,
  integer,
  boolean,
  text,
  varchar,
  index,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { inventorySchema } from "./units";
import { items } from "./items";
import { manufacturingResources } from "./manufacturing-resources";

export const bomRevisions = inventorySchema
  .table(
    "bom_revisions",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      productId: uuid("product_id")
        .notNull()
        .references(() => items.id, { onDelete: "cascade" }),
      revisionNumber: integer("revision_number").notNull(),
      outputQuantity: numeric("output_quantity", {
        precision: 12,
        scale: 4,
      }).notNull().default("1"),
      recipeBasis: varchar("recipe_basis", { length: 16 })
        .notNull()
        .default("unit"),
      isCurrent: boolean("is_current").notNull().default(false),
      note: varchar("note", { length: 500 }),
      createdBy: text("created_by").notNull(),
      parentBomRevisionId: uuid("parent_bom_revision_id").references((): AnyPgColumn => bomRevisions.id, { onDelete: "set null" }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("bom_revisions_org_id_idx").on(table.organizationId),
      index("bom_revisions_product_id_idx").on(table.productId),
      uniqueIndex("bom_revisions_product_revision_uidx").on(
        table.productId,
        table.revisionNumber
      ),
      uniqueIndex("bom_revisions_product_current_uidx")
        .on(table.productId)
        .where(sql`${table.isCurrent} = true`),
      check("bom_revisions_output_quantity_check", sql`output_quantity > 0`),
      check(
        "bom_revisions_recipe_basis_check",
        sql`recipe_basis IN ('unit', 'batch')`
      ),
      pgPolicy("bom_revisions_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const bomRevisionComponents = inventorySchema
  .table(
    "bom_revision_components",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      bomRevisionId: uuid("bom_revision_id")
        .notNull()
        .references(() => bomRevisions.id, { onDelete: "cascade" }),
      componentId: uuid("component_id")
        .notNull()
        .references(() => items.id, { onDelete: "restrict" }),
      componentName: varchar("component_name", { length: 255 }).notNull(),
      componentSku: varchar("component_sku", { length: 50 }),
      componentItemType: varchar("component_item_type", { length: 20 }).notNull(),
      unitName: varchar("unit_name", { length: 50 }).notNull(),
      quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull(),
      sortOrder: integer("sort_order").notNull().default(0),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("bom_revision_components_revision_id_idx").on(table.bomRevisionId),
      index("bom_revision_components_component_id_idx").on(table.componentId),
      uniqueIndex("bom_revision_components_revision_component_uidx").on(
        table.bomRevisionId,
        table.componentId
      ),
      check("bom_revision_components_no_self_reference", sql`component_id IS NOT NULL`),
      pgPolicy("bom_revision_components_org_isolation", {
        for: "all",
        to: "public",
        using: sql`bom_revision_id IN (
          SELECT id
          FROM inventory.bom_revisions
          WHERE organization_id = current_setting('app.current_org_id', true)
        )`,
        withCheck: sql`bom_revision_id IN (
          SELECT id
          FROM inventory.bom_revisions
          WHERE organization_id = current_setting('app.current_org_id', true)
        )`,
      }),
    ]
  )
  .enableRLS();

export const bomRevisionComponentAlternates = inventorySchema
  .table(
    "bom_revision_component_alternates",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      bomRevisionComponentId: uuid("bom_revision_component_id")
        .notNull()
        .references(() => bomRevisionComponents.id, { onDelete: "cascade" }),
      alternateItemId: uuid("alternate_item_id")
        .notNull()
        .references(() => items.id, { onDelete: "restrict" }),
      alternateItemName: varchar("alternate_item_name", { length: 255 }).notNull(),
      alternateItemSku: varchar("alternate_item_sku", { length: 50 }),
      alternateItemType: varchar("alternate_item_type", { length: 20 }).notNull(),
      unitName: varchar("unit_name", { length: 50 }).notNull(),
      // The quantity of this alternate that replaces the component line, in the alternate's
      // own unit, exactly as the recipe author typed it. Nothing is scaled or derived: a
      // bigger package is a different number, not a multiple of the base one.
      quantity: numeric("quantity", { precision: 12, scale: 4 }),
      // Legacy multiplier from the superseded alternate-yield design. Retained so rows
      // written before quantity existed still read; new writes set quantity instead.
      quantityFactor: numeric("quantity_factor", { precision: 12, scale: 4 }),
      sortOrder: integer("sort_order").notNull().default(0),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("bom_revision_component_alternates_component_id_idx").on(
        table.bomRevisionComponentId
      ),
      index("bom_revision_component_alternates_item_id_idx").on(
        table.alternateItemId
      ),
      uniqueIndex("bom_revision_component_alternates_component_item_uidx").on(
        table.bomRevisionComponentId,
        table.alternateItemId
      ),
      check(
        "bom_revision_component_alternates_quantity_factor_check",
        sql`quantity_factor IS NULL OR quantity_factor > 0`
      ),
      check(
        "bom_revision_component_alternates_quantity_check",
        sql`quantity IS NULL OR quantity > 0`
      ),
      // One of the two must describe the alternate, or the row says nothing.
      check(
        "bom_revision_component_alternates_amount_present_check",
        sql`quantity IS NOT NULL OR quantity_factor IS NOT NULL`
      ),
      pgPolicy("bom_revision_component_alternates_org_isolation", {
        for: "all",
        to: "public",
        using: sql`bom_revision_component_id IN (
          SELECT c.id
          FROM inventory.bom_revision_components c
          INNER JOIN inventory.bom_revisions r
            ON r.id = c.bom_revision_id
          WHERE r.organization_id = current_setting('app.current_org_id', true)
        )`,
        withCheck: sql`bom_revision_component_id IN (
          SELECT c.id
          FROM inventory.bom_revision_components c
          INNER JOIN inventory.bom_revisions r
            ON r.id = c.bom_revision_id
          WHERE r.organization_id = current_setting('app.current_org_id', true)
        )`,
      }),
    ]
  )
  .enableRLS();

export const BOM_COMPONENT_CONSTRAINT_TYPES = ["lot_age_min_days"] as const;
export type BomComponentConstraintType =
  (typeof BOM_COMPONENT_CONSTRAINT_TYPES)[number];

export type BomComponentConstraintConfig = {
  days: number;
  basis: "received_at";
};

export const bomRevisionComponentConstraints = inventorySchema
  .table(
    "bom_revision_component_constraints",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      bomRevisionComponentId: uuid("bom_revision_component_id")
        .notNull()
        .references(() => bomRevisionComponents.id, { onDelete: "cascade" }),
      constraintType: varchar("constraint_type", { length: 64 }).notNull(),
      config: jsonb("config").$type<BomComponentConstraintConfig>().notNull(),
      sortOrder: integer("sort_order").notNull().default(0),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("bom_revision_component_constraints_component_id_idx").on(
        table.bomRevisionComponentId
      ),
      uniqueIndex("bom_revision_component_constraints_component_type_uidx").on(
        table.bomRevisionComponentId,
        table.constraintType
      ),
      check(
        "bom_revision_component_constraints_type_check",
        sql`constraint_type IN ('lot_age_min_days')`
      ),
      check(
        "bom_revision_component_constraints_config_check",
        sql`constraint_type <> 'lot_age_min_days'
          OR (
            config->>'basis' = 'received_at'
            AND (config->>'days') ~ '^[1-9][0-9]*$'
          )`
      ),
      pgPolicy("bom_revision_component_constraints_org_isolation", {
        for: "all",
        to: "public",
        using: sql`bom_revision_component_id IN (
          SELECT c.id
          FROM inventory.bom_revision_components c
          INNER JOIN inventory.bom_revisions r
            ON r.id = c.bom_revision_id
          WHERE r.organization_id = current_setting('app.current_org_id', true)
        )`,
        withCheck: sql`bom_revision_component_id IN (
          SELECT c.id
          FROM inventory.bom_revision_components c
          INNER JOIN inventory.bom_revisions r
            ON r.id = c.bom_revision_id
          WHERE r.organization_id = current_setting('app.current_org_id', true)
        )`,
      }),
    ]
  )
  .enableRLS();

export const BOM_OPERATION_COST_SCALING_MODES = [
  "per_output_unit",
  "fixed_per_mo",
] as const;
export type BomOperationCostScalingMode =
  (typeof BOM_OPERATION_COST_SCALING_MODES)[number];

export const bomRevisionOperationCosts = inventorySchema
  .table(
    "bom_revision_operation_costs",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      bomRevisionId: uuid("bom_revision_id")
        .notNull()
        .references(() => bomRevisions.id, { onDelete: "cascade" }),
      resourceId: uuid("resource_id")
        .notNull()
        .references(() => manufacturingResources.id, { onDelete: "restrict" }),
      operationName: varchar("operation_name", { length: 255 }).notNull(),
      resourceName: varchar("resource_name", { length: 255 }).notNull(),
      resourceType: varchar("resource_type", { length: 20 }).notNull(),
      costScalingMode: varchar("cost_scaling_mode", { length: 30 })
        .$type<BomOperationCostScalingMode>()
        .notNull(),
      crewSize: numeric("crew_size", { precision: 12, scale: 4 }).notNull(),
      plannedMinutes: numeric("planned_minutes", {
        precision: 12,
        scale: 4,
      }).notNull(),
      loadedCostPerHour: numeric("loaded_cost_per_hour", {
        precision: 18,
        scale: 6,
      }).notNull(),
      plannedCostTotal: numeric("planned_cost_total", {
        precision: 18,
        scale: 6,
      }).notNull(),
      sortOrder: integer("sort_order").notNull().default(0),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("bom_revision_operation_costs_revision_idx").on(table.bomRevisionId),
      index("bom_revision_operation_costs_resource_idx").on(table.resourceId),
      check(
        "bom_revision_operation_costs_scaling_mode_check",
        sql`cost_scaling_mode IN ('per_output_unit', 'fixed_per_mo')`
      ),
      check("bom_revision_operation_costs_crew_size_check", sql`crew_size > 0`),
      check(
        "bom_revision_operation_costs_minutes_check",
        sql`planned_minutes > 0`
      ),
      check(
        "bom_revision_operation_costs_rate_check",
        sql`loaded_cost_per_hour >= 0`
      ),
      check(
        "bom_revision_operation_costs_total_check",
        sql`planned_cost_total >= 0`
      ),
      pgPolicy("bom_revision_operation_costs_org_isolation", {
        for: "all",
        to: "public",
        using: sql`bom_revision_id IN (
          SELECT id
          FROM inventory.bom_revisions
          WHERE organization_id = current_setting('app.current_org_id', true)
        )`,
        withCheck: sql`bom_revision_id IN (
          SELECT id
          FROM inventory.bom_revisions
          WHERE organization_id = current_setting('app.current_org_id', true)
        )`,
      }),
    ]
  )
  .enableRLS();
