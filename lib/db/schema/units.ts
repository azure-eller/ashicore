import {
  pgSchema,
  varchar,
  uuid,
  text,
  numeric,
  timestamp,
  pgPolicy,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const inventorySchema = pgSchema("inventory");

// Org-specific unit definitions (e.g. "bale" + 225 + "liters", "bag" + 1 + "ft3")
// uom values come from the `convert` npm library (e.g. "liters", "ft3", "yd3", "lb")
export const unitDefinitions = inventorySchema
  .table(
    "unit_definitions",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      name: varchar("name", { length: 50 }).notNull(),
      size: numeric("size", { precision: 10, scale: 4 }).notNull(),
      uom: varchar("uom", { length: 30 }).notNull(),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("unit_definitions_org_id_idx").on(table.organizationId),
      pgPolicy("unit_definitions_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();
