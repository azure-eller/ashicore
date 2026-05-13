import {
  index,
  pgPolicy,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const addressesSchema = pgSchema("addresses");

export const addressEntries = addressesSchema
  .table(
    "entries",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      label: varchar("label", { length: 120 }).notNull(),
      contactName: varchar("contact_name", { length: 255 }),
      contactPhone: varchar("contact_phone", { length: 50 }),
      line1: varchar("line1", { length: 255 }),
      line2: varchar("line2", { length: 255 }),
      city: varchar("city", { length: 120 }),
      region: varchar("region", { length: 120 }),
      postcode: varchar("postcode", { length: 30 }),
      country: varchar("country", { length: 120 }),
      deliveryInstructions: text("delivery_instructions"),
      notes: text("notes"),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("address_entries_org_id_idx").on(table.organizationId),
      index("address_entries_active_idx")
        .on(table.organizationId)
        .where(sql`deleted_at IS NULL`),
      uniqueIndex("address_entries_org_label_uidx")
        .on(table.organizationId, table.label)
        .where(sql`deleted_at IS NULL`),
      pgPolicy("address_entries_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();
