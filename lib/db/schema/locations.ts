import {
  boolean,
  index,
  pgPolicy,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { inventorySchema } from "./units";

export const inventoryLocations = inventorySchema
  .table(
    "locations",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      name: varchar("name", { length: 100 }).notNull(),
      code: varchar("code", { length: 40 }).notNull(),
      isDefault: boolean("is_default").notNull().default(false),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("inventory_locations_org_idx").on(table.organizationId),
      uniqueIndex("inventory_locations_org_code_uidx")
        .on(table.organizationId, table.code)
        .where(sql`${table.deletedAt} IS NULL`),
      uniqueIndex("inventory_locations_org_default_uidx")
        .on(table.organizationId, table.isDefault)
        .where(sql`${table.isDefault} = true AND ${table.deletedAt} IS NULL`),
      pgPolicy("inventory_locations_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();
