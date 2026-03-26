import {
  uuid,
  text,
  numeric,
  timestamp,
  varchar,
  pgPolicy,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { inventorySchema } from "./units";
import { items } from "./items";
import { lots } from "./lots";

export const stockMovements = inventorySchema
  .table(
    "stock_movements",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      itemId: uuid("item_id")
        .notNull()
        .references(() => items.id),
      lotId: uuid("lot_id").references(() => lots.id),
      quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull(),
      movementType: varchar("movement_type", { length: 32 })
        .notNull()
        .default("manual_adjustment"),
      referenceType: varchar("reference_type", { length: 32 }),
      referenceId: uuid("reference_id"),
      createdBy: text("created_by").notNull(),
      createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (table) => [
      index("stock_movements_item_id_idx").on(table.itemId),
      index("stock_movements_created_at_idx").on(table.createdAt),
      pgPolicy("stock_movements_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();
