import {
  check,
  index,
  numeric,
  pgPolicy,
  pgSchema,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const manufacturingResourcesSchema = pgSchema("manufacturing");

export const MANUFACTURING_RESOURCE_TYPES = [
  "labor",
  "machine",
  "overhead",
  "other",
] as const;
export type ManufacturingResourceType =
  (typeof MANUFACTURING_RESOURCE_TYPES)[number];

export const manufacturingResources = manufacturingResourcesSchema
  .table(
    "resources",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      name: varchar("name", { length: 255 }).notNull(),
      description: varchar("description", { length: 500 }),
      resourceType: varchar("resource_type", { length: 20 })
        .$type<ManufacturingResourceType>()
        .notNull(),
      loadedCostPerHour: numeric("loaded_cost_per_hour", {
        precision: 18,
        scale: 6,
      }).notNull(),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("manufacturing_resources_org_idx").on(table.organizationId),
      index("manufacturing_resources_active_idx")
        .on(table.organizationId, table.name)
        .where(sql`deleted_at IS NULL`),
      check(
        "manufacturing_resources_type_check",
        sql`resource_type IN ('labor', 'machine', 'overhead', 'other')`
      ),
      check(
        "manufacturing_resources_loaded_cost_check",
        sql`loaded_cost_per_hour >= 0`
      ),
      pgPolicy("manufacturing_resources_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();
