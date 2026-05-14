import {
  boolean,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const integrationsSchema = pgSchema("integrations");

export type IntegrationAuthorizedTenant = {
  tenantId: string;
  tenantName: string;
};

export const integrationConnections = integrationsSchema
  .table(
    "connections",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      provider: varchar("provider", { length: 50 }).notNull(),
      tenantId: text("tenant_id").notNull(),
      tenantName: text("tenant_name").notNull(),
      authorizedTenants: jsonb("authorized_tenants")
        .$type<IntegrationAuthorizedTenant[]>()
        .notNull()
        .default(sql`'[]'::jsonb`),
      accessTokenCiphertext: text("access_token_ciphertext").notNull(),
      refreshTokenCiphertext: text("refresh_token_ciphertext").notNull(),
      tokenEncryptionKeyId: varchar("token_encryption_key_id", { length: 100 }).notNull(),
      tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }).notNull(),
      defaultAccountCode: varchar("default_account_code", { length: 20 }),
      defaultTaxType: varchar("default_tax_type", { length: 50 }),
      invoiceStatusPreference: varchar("invoice_status_preference", {
        length: 20,
      })
        .notNull()
        .default("DRAFT"),
      autoPushSalesInvoices: boolean("auto_push_sales_invoices")
        .notNull()
        .default(false),
      autoPushPurchaseOrders: boolean("auto_push_purchase_orders")
        .notNull()
        .default(false),
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
      settings: jsonb("settings").$type<Record<string, unknown>>(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("integration_connections_org_provider_idx").on(
        table.organizationId,
        table.provider
      ),
      index("integration_connections_tenant_idx").on(table.provider, table.tenantId),
      uniqueIndex("integration_connections_org_provider_uidx").on(
        table.organizationId,
        table.provider
      ),
      pgPolicy("integration_connections_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export type IntegrationExternalEntityType = "item" | "customer" | "supplier";

export const integrationExternalRecords = integrationsSchema
  .table(
    "external_records",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      provider: varchar("provider", { length: 50 }).notNull(),
      entityType: varchar("entity_type", { length: 50 })
        .$type<IntegrationExternalEntityType>()
        .notNull(),
      localRecordId: uuid("local_record_id").notNull(),
      externalId: text("external_id"),
      externalCode: varchar("external_code", { length: 100 }),
      externalName: varchar("external_name", { length: 255 }),
      externalDescription: text("external_description"),
      metadata: jsonb("metadata").$type<Record<string, unknown>>(),
      externalUpdatedAt: timestamp("external_updated_at", { withTimezone: true }),
      lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("external_records_org_provider_idx").on(table.organizationId, table.provider),
      index("external_records_local_idx").on(
        table.organizationId,
        table.provider,
        table.entityType,
        table.localRecordId
      ),
      uniqueIndex("external_records_local_uidx").on(
        table.organizationId,
        table.provider,
        table.entityType,
        table.localRecordId
      ),
      uniqueIndex("external_records_external_id_uidx")
        .on(table.organizationId, table.provider, table.entityType, table.externalId)
        .where(sql`external_id IS NOT NULL`),
      uniqueIndex("external_records_external_code_uidx")
        .on(table.organizationId, table.provider, table.entityType, table.externalCode)
        .where(sql`external_code IS NOT NULL`),
      pgPolicy("external_records_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export type IntegrationImportEntityType = "customers" | "suppliers" | "purchasing";
export type IntegrationImportRunStatus = "completed" | "undone";
export type IntegrationImportRowAction = "created" | "updated";

export const integrationImportRuns = integrationsSchema
  .table(
    "import_runs",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      provider: varchar("provider", { length: 50 }).notNull(),
      entityType: varchar("entity_type", { length: 20 })
        .$type<IntegrationImportEntityType>()
        .notNull(),
      tenantId: text("tenant_id").notNull(),
      tenantName: text("tenant_name").notNull(),
      status: varchar("status", { length: 20 })
        .$type<IntegrationImportRunStatus>()
        .notNull()
        .default("completed"),
      createdCount: integer("created_count").notNull().default(0),
      updatedCount: integer("updated_count").notNull().default(0),
      skippedCount: integer("skipped_count").notNull().default(0),
      errorCount: integer("error_count").notNull().default(0),
      undoneAt: timestamp("undone_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("integration_import_runs_org_provider_entity_idx").on(
        table.organizationId,
        table.provider,
        table.entityType,
        table.createdAt
      ),
      pgPolicy("integration_import_runs_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const integrationImportRunRows = integrationsSchema
  .table(
    "import_run_rows",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      provider: varchar("provider", { length: 50 }).notNull(),
      runId: uuid("run_id")
        .notNull()
        .references(() => integrationImportRuns.id, { onDelete: "cascade" }),
      entityType: varchar("entity_type", { length: 20 })
        .$type<IntegrationImportEntityType>()
        .notNull(),
      action: varchar("action", { length: 20 })
        .$type<IntegrationImportRowAction>()
        .notNull(),
      localRecordId: uuid("local_record_id").notNull(),
      externalRecordId: text("external_record_id"),
      localName: text("local_name").notNull(),
      previousData: jsonb("previous_data"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("integration_import_run_rows_run_idx").on(table.runId),
      index("integration_import_run_rows_local_record_idx").on(
        table.provider,
        table.entityType,
        table.localRecordId
      ),
      pgPolicy("integration_import_run_rows_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();
