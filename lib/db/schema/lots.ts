import {
  uuid,
  varchar,
  text,
  numeric,
  timestamp,
  pgPolicy,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { inventorySchema } from "./units";
import { items } from "./items";

export const lots = inventorySchema
  .table(
    "lots",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      itemId: uuid("item_id")
        .notNull()
        .references(() => items.id),
      lotNumber: varchar("lot_number", { length: 128 }).notNull(),
      quantity: numeric("quantity", { precision: 12, scale: 4 })
        .notNull()
        .default("0"),
      receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      uniqueIndex("lots_org_lot_number_uidx").on(
        table.organizationId,
        table.lotNumber
      ),
      index("lots_item_id_idx").on(table.itemId),
      pgPolicy("lots_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();
