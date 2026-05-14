import {
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
import { attachmentFiles } from "./attachments";

export const accountingSchema = pgSchema("accounting");

export const accountingClassifications = accountingSchema
  .table(
    "classifications",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      provider: varchar("provider", { length: 50 }).notNull(),
      entityType: varchar("entity_type", { length: 50 }).notNull(),
      localRecordId: uuid("local_record_id").notNull(),
      accountCode: varchar("account_code", { length: 20 }),
      taxType: varchar("tax_type", { length: 50 }),
      metadata: jsonb("metadata").$type<Record<string, unknown>>(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("accounting_classifications_org_provider_idx").on(
        table.organizationId,
        table.provider
      ),
      uniqueIndex("accounting_classifications_local_uidx").on(
        table.organizationId,
        table.provider,
        table.entityType,
        table.localRecordId
      ),
      pgPolicy("accounting_classifications_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const accountingDocumentSyncs = accountingSchema
  .table(
    "document_syncs",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      provider: varchar("provider", { length: 50 }).notNull(),
      documentType: varchar("document_type", { length: 50 }).notNull(),
      documentId: uuid("document_id").notNull(),
      externalDocumentId: text("external_document_id"),
      externalDocumentNumber: varchar("external_document_number", { length: 100 }),
      pushStatus: varchar("push_status", { length: 20 }),
      pushError: text("push_error"),
      pushedAt: timestamp("pushed_at", { withTimezone: true }),
      pushPayloadHash: text("push_payload_hash"),
      lastPushAttemptAt: timestamp("last_push_attempt_at", { withTimezone: true }),
      retryCount: integer("retry_count").notNull().default(0),
      emailStatus: varchar("email_status", { length: 20 }),
      emailError: text("email_error"),
      emailedAt: timestamp("emailed_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("accounting_document_syncs_org_provider_idx").on(
        table.organizationId,
        table.provider
      ),
      uniqueIndex("accounting_document_syncs_document_uidx").on(
        table.organizationId,
        table.provider,
        table.documentType,
        table.documentId
      ),
      pgPolicy("accounting_document_syncs_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const accountingAttachmentSyncs = accountingSchema
  .table(
    "attachment_syncs",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      provider: varchar("provider", { length: 50 }).notNull(),
      attachmentId: uuid("attachment_id")
        .notNull()
        .references(() => attachmentFiles.id, { onDelete: "cascade" }),
      externalAttachmentId: text("external_attachment_id"),
      syncStatus: varchar("sync_status", { length: 20 }),
      syncError: text("sync_error"),
      syncedAt: timestamp("synced_at", { withTimezone: true }),
      lastSyncAttemptAt: timestamp("last_sync_attempt_at", { withTimezone: true }),
      retryCount: integer("retry_count").notNull().default(0),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("accounting_attachment_syncs_org_provider_idx").on(
        table.organizationId,
        table.provider
      ),
      uniqueIndex("accounting_attachment_syncs_attachment_uidx").on(
        table.organizationId,
        table.provider,
        table.attachmentId
      ),
      pgPolicy("accounting_attachment_syncs_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();
