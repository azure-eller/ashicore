import {
  index,
  pgPolicy,
  pgSchema,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const xeroSchema = pgSchema("xero");

export const xeroConnections = xeroSchema
  .table(
    "xero_connections",
    {
      organizationId: text("organization_id").primaryKey(),
      tenantId: text("tenant_id").notNull(),
      tenantName: text("tenant_name").notNull(),
      accessToken: text("access_token").notNull(),
      refreshToken: text("refresh_token").notNull(),
      tokenExpiresAt: timestamp("token_expires_at").notNull(),
      defaultAccountCode: varchar("default_account_code", { length: 20 }),
      defaultTaxType: varchar("default_tax_type", { length: 50 }),
      invoiceStatusPreference: varchar("invoice_status_preference", {
        length: 20,
      })
        .notNull()
        .default("AUTHORISED"),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => [
      index("xero_connections_tenant_idx").on(table.tenantId),
      pgPolicy("xero_connections_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();
