import {
  uuid,
  numeric,
  timestamp,
  unique,
  check,
  pgPolicy,
  integer,
  boolean,
  text,
  varchar,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { inventorySchema } from "./units";
import { items } from "./items";

export const bomComponents = inventorySchema
  .table(
    "bom_components",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      itemId: uuid("item_id")
        .notNull()
        .references(() => items.id, { onDelete: "cascade" }),
      componentId: uuid("component_id")
        .notNull()
        .references(() => items.id, { onDelete: "restrict" }),
      quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull(),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => [
      unique("unique_bom_component").on(table.itemId, table.componentId),
      check("no_self_reference", sql`item_id != component_id`),
      pgPolicy("bom_components_org_isolation", {
        for: "all",
        to: "public",
        using: sql`
          item_id IN (
            SELECT id
            FROM inventory.items
            WHERE organization_id = current_setting('app.current_org_id', true)
          )
          AND component_id IN (
            SELECT id
            FROM inventory.items
            WHERE organization_id = current_setting('app.current_org_id', true)
          )
        `,
        withCheck: sql`
          item_id IN (
            SELECT id
            FROM inventory.items
            WHERE organization_id = current_setting('app.current_org_id', true)
          )
          AND component_id IN (
            SELECT id
            FROM inventory.items
            WHERE organization_id = current_setting('app.current_org_id', true)
          )
        `,
      }),
    ]
  )
  .enableRLS();

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
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
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
      sortOrder: integer("sort_order").notNull().default(0),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
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
