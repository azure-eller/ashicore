import {
  boolean,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgSchema,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export type XeroAuthorizedTenant = {
  tenantId: string;
  tenantName: string;
};

export const xeroSchema = pgSchema("xero");

export const xeroConnections = xeroSchema
  .table(
    "xero_connections",
    {
      organizationId: text("organization_id").primaryKey(),
      tenantId: text("tenant_id").notNull(),
      tenantName: text("tenant_name").notNull(),
      authorizedTenants: jsonb("authorized_tenants")
        .$type<XeroAuthorizedTenant[]>()
        .notNull()
        .default(sql`'[]'::jsonb`),
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
      autoEmailSalesInvoices: boolean("auto_email_sales_invoices")
        .notNull()
        .default(false),
      autoEmailPurchaseOrders: boolean("auto_email_purchase_orders")
        .notNull()
        .default(false),
      purchaseOrderDefaultAccountCode: varchar(
        "purchase_order_default_account_code",
        { length: 20 }
      ),
      purchaseOrderDefaultTaxType: varchar("purchase_order_default_tax_type", {
        length: 50,
      }),
      purchaseOrderStatusPreference: varchar(
        "purchase_order_status_preference",
        { length: 20 }
      )
        .notNull()
        .default("DRAFT"),
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

export type XeroImportEntityType = "customers" | "suppliers";
export type XeroImportRunStatus = "completed" | "undone";
export type XeroImportRowAction = "created" | "updated";

export const xeroImportRuns = xeroSchema
  .table(
    "xero_import_runs",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      entityType: varchar("entity_type", { length: 20 })
        .$type<XeroImportEntityType>()
        .notNull(),
      tenantId: text("tenant_id").notNull(),
      tenantName: text("tenant_name").notNull(),
      status: varchar("status", { length: 20 })
        .$type<XeroImportRunStatus>()
        .notNull()
        .default("completed"),
      createdCount: integer("created_count").notNull().default(0),
      updatedCount: integer("updated_count").notNull().default(0),
      skippedCount: integer("skipped_count").notNull().default(0),
      errorCount: integer("error_count").notNull().default(0),
      undoneAt: timestamp("undone_at"),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => [
      index("xero_import_runs_org_entity_idx").on(
        table.organizationId,
        table.entityType,
        table.createdAt
      ),
      pgPolicy("xero_import_runs_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const xeroImportRunRows = xeroSchema
  .table(
    "xero_import_run_rows",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      runId: uuid("run_id")
        .notNull()
        .references(() => xeroImportRuns.id, { onDelete: "cascade" }),
      entityType: varchar("entity_type", { length: 20 })
        .$type<XeroImportEntityType>()
        .notNull(),
      action: varchar("action", { length: 20 })
        .$type<XeroImportRowAction>()
        .notNull(),
      localRecordId: uuid("local_record_id").notNull(),
      xeroContactId: text("xero_contact_id"),
      localName: text("local_name").notNull(),
      previousData: jsonb("previous_data"),
      createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (table) => [
      index("xero_import_run_rows_run_idx").on(table.runId),
      index("xero_import_run_rows_local_record_idx").on(
        table.entityType,
        table.localRecordId
      ),
      pgPolicy("xero_import_run_rows_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();
