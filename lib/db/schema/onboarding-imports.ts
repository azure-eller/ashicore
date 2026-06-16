import {
  boolean,
  index,
  integer,
  jsonb,
  pgPolicy,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { inventorySchema } from "./units";

export const importSessions = inventorySchema
  .table(
    "import_sessions",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      createdByUserId: text("created_by_user_id").notNull(),
      status: varchar("status", { length: 32 }).notNull().default("uploaded"),
      draftPackage: jsonb("draft_package"),
      normalizedPackage: jsonb("normalized_package"),
      approvedPackage: jsonb("approved_package"),
      approvedPackageHash: varchar("approved_package_hash", { length: 128 }),
      approvedByUserId: text("approved_by_user_id"),
      approvedAt: timestamp("approved_at", { withTimezone: true }),
      committedAt: timestamp("committed_at", { withTimezone: true }),
      commitSummary: jsonb("commit_summary"),
      openingStockAsOf: varchar("opening_stock_as_of", { length: 10 }),
      includeBoms: boolean("include_boms").notNull().default(true),
      error: text("error"),
      processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),
      processingLeaseUntil: timestamp("processing_lease_until", { withTimezone: true }),
      attemptCount: integer("attempt_count").notNull().default(0),
      lastError: text("last_error"),
      expiresAt: timestamp("expires_at", { withTimezone: true }),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("import_sessions_org_status_idx").on(table.organizationId, table.status),
      index("import_sessions_active_idx")
        .on(table.organizationId)
        .where(sql`deleted_at IS NULL`),
      pgPolicy("import_sessions_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ],
  )
  .enableRLS();

export const onboardingSessions = inventorySchema
  .table(
    "onboarding_sessions",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      createdByUserId: text("created_by_user_id").notNull(),
      selectedPlan: varchar("selected_plan", { length: 32 }),
      selectedLocationCapacity: integer("selected_location_capacity").notNull().default(1),
      selectedAddonLookupKeys: jsonb("selected_addon_lookup_keys")
        .$type<string[]>()
        .notNull()
        .default([]),
      status: varchar("status", { length: 32 }).notNull().default("org_created"),
      currentStep: varchar("current_step", { length: 64 }).notNull().default("import"),
      importSessionId: uuid("import_session_id").references(() => importSessions.id, {
        onDelete: "set null",
      }),
      invitesDraft: jsonb("invites_draft").$type<Array<{ email: string; role: string }> | null>(),
      completedAt: timestamp("completed_at", { withTimezone: true }),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("onboarding_sessions_org_status_idx").on(table.organizationId, table.status),
      uniqueIndex("onboarding_sessions_active_org_uidx")
        .on(table.organizationId)
        .where(sql`deleted_at IS NULL AND completed_at IS NULL`),
      pgPolicy("onboarding_sessions_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ],
  )
  .enableRLS();

export const importFiles = inventorySchema
  .table(
    "import_files",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      sessionId: uuid("session_id")
        .notNull()
        .references(() => importSessions.id, { onDelete: "cascade" }),
      organizationId: text("organization_id").notNull(),
      filename: text("filename").notNull(),
      contentType: varchar("content_type", { length: 255 }).notNull(),
      sizeBytes: integer("size_bytes").notNull(),
      storageKey: text("storage_key").notNull(),
      extractionStatus: varchar("extraction_status", { length: 32 })
        .notNull()
        .default("pending"),
      extractionError: text("extraction_error"),
      extractedAt: timestamp("extracted_at", { withTimezone: true }),
      extractedPackage: jsonb("extracted_package"),
      expiresAt: timestamp("expires_at", { withTimezone: true }),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("import_files_session_idx").on(table.sessionId),
      index("import_files_org_status_idx").on(table.organizationId, table.extractionStatus),
      uniqueIndex("import_files_storage_key_uidx").on(table.storageKey),
      pgPolicy("import_files_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ],
  )
  .enableRLS();

export const importCommitRecords = inventorySchema
  .table(
    "import_commit_records",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      sessionId: uuid("session_id")
        .notNull()
        .references(() => importSessions.id, { onDelete: "cascade" }),
      organizationId: text("organization_id").notNull(),
      recordType: varchar("record_type", { length: 64 }).notNull(),
      action: varchar("action", { length: 32 }).notNull(),
      localRecordId: uuid("local_record_id"),
      details: jsonb("details"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("import_commit_records_session_idx").on(table.sessionId),
      index("import_commit_records_org_type_idx").on(table.organizationId, table.recordType),
      pgPolicy("import_commit_records_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ],
  )
  .enableRLS();
