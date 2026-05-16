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
      consumptionMode: varchar("consumption_mode", { length: 32 })
        .notNull()
        .default("per_output_unit"),
      basisOutputQuantity: numeric("basis_output_quantity", {
        precision: 12,
        scale: 4,
      }),
      batchScalingMode: varchar("batch_scaling_mode", { length: 32 }),
      groupRemainderPolicy: varchar("group_remainder_policy", { length: 32 }),
      scalingReviewRecommended: boolean("scaling_review_recommended")
        .notNull()
        .default(false),
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
      check(
        "bom_revision_components_consumption_mode_check",
        sql`consumption_mode IN ('per_output_unit', 'per_batch', 'per_group')`
      ),
      check(
        "bom_revision_components_batch_scaling_mode_check",
        sql`batch_scaling_mode IS NULL OR batch_scaling_mode IN ('proportional', 'full_batches_only')`
      ),
      check(
        "bom_revision_components_group_remainder_policy_check",
        sql`group_remainder_policy IS NULL OR group_remainder_policy IN ('ask', 'leave_loose', 'create_partial_group')`
      ),
      check(
        "bom_revision_components_basis_output_quantity_check",
        sql`(
          consumption_mode = 'per_output_unit'
          AND basis_output_quantity IS NULL
        ) OR (
          consumption_mode IN ('per_batch', 'per_group')
          AND basis_output_quantity IS NOT NULL
          AND basis_output_quantity > 0
        )`
      ),
      check(
        "bom_revision_components_batch_fields_check",
        sql`(
          consumption_mode = 'per_batch'
          AND batch_scaling_mode IS NOT NULL
          AND group_remainder_policy IS NULL
        ) OR consumption_mode <> 'per_batch'`
      ),
      check(
        "bom_revision_components_group_fields_check",
        sql`(
          consumption_mode = 'per_group'
          AND group_remainder_policy IS NOT NULL
          AND batch_scaling_mode IS NULL
        ) OR consumption_mode <> 'per_group'`
      ),
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
      quantityFactor: numeric("quantity_factor", { precision: 12, scale: 4 }).notNull(),
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
        sql`quantity_factor > 0`
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
