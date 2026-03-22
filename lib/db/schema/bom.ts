import {
  uuid,
  numeric,
  timestamp,
  unique,
  check,
  pgPolicy,
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
      quantity: numeric("quantity", { precision: 12, scale: 4 }),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => [
      unique("unique_bom_component").on(table.itemId, table.componentId),
      check("no_self_reference", sql`item_id != component_id`),
      pgPolicy("bom_components_org_isolation", {
        for: "all",
        to: "public",
        using: sql`item_id IN (SELECT id FROM inventory.items WHERE organization_id = current_setting('app.current_org_id', true))`,
        withCheck: sql`item_id IN (SELECT id FROM inventory.items WHERE organization_id = current_setting('app.current_org_id', true))`,
      }),
    ]
  )
  .enableRLS();
