import {
  index,
  numeric,
  pgPolicy,
  pgSchema,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const planningSchema = pgSchema("planning");

export const organizationPlanningSettings = planningSchema
  .table(
    "organization_planning_settings",
    {
      organizationId: text("organization_id").primaryKey(),
      defaultDailyManufacturingCapacity: numeric("default_daily_manufacturing_capacity", {
        precision: 12,
        scale: 4,
      }),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => [
      index("organization_planning_settings_org_id_idx").on(table.organizationId),
      pgPolicy("organization_planning_settings_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();
