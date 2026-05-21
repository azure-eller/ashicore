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
      autoSyncPurchaseOrdersFromAccounting: boolean(
        "auto_sync_purchase_orders_from_accounting"
      )
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
      uniqueIndex("integration_connections_provider_tenant_uidx").on(
        table.provider,
        table.tenantId
      ),
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
      index("external_records_external_id_idx")
        .on(table.organizationId, table.provider, table.entityType, table.externalId)
        .where(sql`external_id IS NOT NULL`),
      index("external_records_external_code_idx")
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

export type IntegrationImportEntityType =
  | "customers"
  | "suppliers"
  | "purchasing"
  | "purchase_orders";
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

export type IntegrationAuditActorType = "user" | "process";
export type IntegrationAuditOutcome = "success" | "failure";

export const integrationAuditEvents = integrationsSchema
  .table(
    "audit_events",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      occurredAt: timestamp("occurred_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
      actorType: varchar("actor_type", { length: 20 })
        .$type<IntegrationAuditActorType>()
        .notNull(),
      actorUserId: text("actor_user_id"),
      processName: varchar("process_name", { length: 100 }),
      eventType: varchar("event_type", { length: 100 }).notNull(),
      outcome: varchar("outcome", { length: 20 })
        .$type<IntegrationAuditOutcome>()
        .notNull(),
      source: varchar("source", { length: 200 }).notNull(),
      provider: varchar("provider", { length: 50 }).notNull(),
      tenantId: text("tenant_id"),
      tenantName: text("tenant_name"),
      localEntityType: varchar("local_entity_type", { length: 100 }),
      localEntityId: uuid("local_entity_id"),
      metadata: jsonb("metadata").$type<Record<string, unknown>>(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("integration_audit_events_org_occurred_idx").on(
        table.organizationId,
        table.occurredAt
      ),
      index("integration_audit_events_org_provider_idx").on(
        table.organizationId,
        table.provider,
        table.eventType
      ),
      index("integration_audit_events_org_entity_idx")
        .on(table.organizationId, table.localEntityType, table.localEntityId)
        .where(sql`local_entity_id IS NOT NULL`),
      pgPolicy("integration_audit_events_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export type AgentApiTokenScope = "production_planning:read";
export type AgentMcpOAuthScope = "production_planning:read";

export const agentApiTokens = integrationsSchema
  .table(
    "agent_api_tokens",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      createdByUserId: text("created_by_user_id").notNull(),
      name: varchar("name", { length: 120 }).notNull(),
      tokenHash: text("token_hash").notNull(),
      tokenPrefix: varchar("token_prefix", { length: 80 }).notNull(),
      scopes: jsonb("scopes")
        .$type<AgentApiTokenScope[]>()
        .notNull()
        .default(sql`'["production_planning:read"]'::jsonb`),
      lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
      expiresAt: timestamp("expires_at", { withTimezone: true }),
      revokedAt: timestamp("revoked_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date()),
    },
    (table) => [
      uniqueIndex("agent_api_tokens_hash_uidx").on(table.tokenHash),
      index("agent_api_tokens_org_created_idx").on(
        table.organizationId,
        table.createdAt
      ),
      index("agent_api_tokens_org_active_idx")
        .on(table.organizationId, table.revokedAt)
        .where(sql`revoked_at IS NULL`),
      pgPolicy("agent_api_tokens_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const agentMcpOAuthCodes = integrationsSchema
  .table(
    "agent_mcp_oauth_codes",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      userId: text("user_id").notNull(),
      clientId: text("client_id").notNull(),
      redirectUri: text("redirect_uri").notNull(),
      codeHash: text("code_hash").notNull(),
      codeChallenge: text("code_challenge").notNull(),
      codeChallengeMethod: varchar("code_challenge_method", { length: 20 }).notNull(),
      scopes: jsonb("scopes")
        .$type<AgentMcpOAuthScope[]>()
        .notNull()
        .default(sql`'["production_planning:read"]'::jsonb`),
      expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
      consumedAt: timestamp("consumed_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      uniqueIndex("agent_mcp_oauth_codes_hash_uidx").on(table.codeHash),
      index("agent_mcp_oauth_codes_org_created_idx").on(
        table.organizationId,
        table.createdAt
      ),
      index("agent_mcp_oauth_codes_expiry_idx").on(table.expiresAt),
      pgPolicy("agent_mcp_oauth_codes_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const agentMcpOAuthTokens = integrationsSchema
  .table(
    "agent_mcp_oauth_tokens",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      userId: text("user_id").notNull(),
      clientId: text("client_id").notNull(),
      accessTokenHash: text("access_token_hash").notNull(),
      refreshTokenHash: text("refresh_token_hash").notNull(),
      scopes: jsonb("scopes")
        .$type<AgentMcpOAuthScope[]>()
        .notNull()
        .default(sql`'["production_planning:read"]'::jsonb`),
      accessTokenExpiresAt: timestamp("access_token_expires_at", {
        withTimezone: true,
      }).notNull(),
      refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
        withTimezone: true,
      }).notNull(),
      lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
      revokedAt: timestamp("revoked_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date()),
    },
    (table) => [
      uniqueIndex("agent_mcp_oauth_tokens_access_hash_uidx").on(
        table.accessTokenHash
      ),
      uniqueIndex("agent_mcp_oauth_tokens_refresh_hash_uidx").on(
        table.refreshTokenHash
      ),
      index("agent_mcp_oauth_tokens_org_created_idx").on(
        table.organizationId,
        table.createdAt
      ),
      index("agent_mcp_oauth_tokens_active_idx")
        .on(table.organizationId, table.revokedAt)
        .where(sql`revoked_at IS NULL`),
      pgPolicy("agent_mcp_oauth_tokens_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();
