import {
  index,
  numeric,
  pgPolicy,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const settingsSchema = pgSchema("settings");

export const taxRates = settingsSchema
  .table(
    "tax_rates",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      name: varchar("name", { length: 120 }).notNull(),
      ratePercent: numeric("rate_percent", {
        precision: 7,
        scale: 4,
      }).notNull(),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("tax_rates_org_id_idx").on(table.organizationId),
      index("tax_rates_active_idx")
        .on(table.organizationId)
        .where(sql`deleted_at IS NULL`),
      uniqueIndex("tax_rates_org_name_uidx")
        .on(table.organizationId, table.name)
        .where(sql`deleted_at IS NULL`),
      pgPolicy("tax_rates_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ],
  )
  .enableRLS();

export const organizationTaxSettings = settingsSchema
  .table(
    "organization_tax_settings",
    {
      organizationId: text("organization_id").primaryKey(),
      defaultSalesTaxRateId: uuid("default_sales_tax_rate_id").references(
        () => taxRates.id,
        { onDelete: "set null" },
      ),
      defaultPurchaseTaxRateId: uuid("default_purchase_tax_rate_id").references(
        () => taxRates.id,
        { onDelete: "set null" },
      ),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("organization_tax_settings_default_sales_idx").on(
        table.defaultSalesTaxRateId,
      ),
      index("organization_tax_settings_default_purchase_idx").on(
        table.defaultPurchaseTaxRateId,
      ),
      pgPolicy("organization_tax_settings_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ],
  )
  .enableRLS();
