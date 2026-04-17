import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgPolicy,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const agentSchema = pgSchema("agent");

const orgIsolationPolicy = (name: string) =>
  pgPolicy(name, {
    for: "all",
    to: "public",
    using: sql`organization_id = current_setting('app.current_org_id', true)`,
    withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
  });

export const agentSessions = agentSchema
  .table(
    "sessions",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      createdByUserId: text("created_by_user_id").notNull(),
      status: varchar("status", { length: 32 }).notNull(),
      title: varchar("title", { length: 255 }),
      messages: jsonb("messages")
        .$type<unknown[]>()
        .notNull()
        .default(sql`'[]'::jsonb`),
      lastError: text("last_error"),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => [
      index("agent_sessions_org_id_idx").on(table.organizationId),
      index("agent_sessions_user_id_idx").on(table.createdByUserId),
      index("agent_sessions_updated_at_idx").on(table.updatedAt),
      orgIsolationPolicy("agent_sessions_org_isolation"),
    ]
  )
  .enableRLS();

export const agentTurns = agentSchema
  .table(
    "turns",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      sessionId: uuid("session_id")
        .notNull()
        .references(() => agentSessions.id, { onDelete: "cascade" }),
      organizationId: text("organization_id").notNull(),
      createdByUserId: text("created_by_user_id").notNull(),
      status: varchar("status", { length: 32 }).notNull(),
      userInput: jsonb("user_input").$type<unknown>().notNull(),
      startedAt: timestamp("started_at").notNull().defaultNow(),
      finishedAt: timestamp("finished_at"),
      summary: text("summary"),
    },
    (table) => [
      index("agent_turns_session_id_idx").on(table.sessionId),
      index("agent_turns_org_id_idx").on(table.organizationId),
      index("agent_turns_started_at_idx").on(table.startedAt),
      orgIsolationPolicy("agent_turns_org_isolation"),
    ]
  )
  .enableRLS();

export const agentPendingRequests = agentSchema
  .table(
    "pending_requests",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      sessionId: uuid("session_id")
        .notNull()
        .references(() => agentSessions.id, { onDelete: "cascade" }),
      turnId: uuid("turn_id")
        .notNull()
        .references(() => agentTurns.id, { onDelete: "cascade" }),
      organizationId: text("organization_id").notNull(),
      kind: varchar("kind", { length: 32 }).notNull(),
      toolName: varchar("tool_name", { length: 100 }).notNull(),
      payload: jsonb("payload").$type<unknown>().notNull(),
      resolvedAt: timestamp("resolved_at"),
      resolution: jsonb("resolution").$type<unknown>(),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => [
      index("agent_pending_requests_session_id_idx").on(table.sessionId),
      index("agent_pending_requests_turn_id_idx").on(table.turnId),
      uniqueIndex("agent_pending_requests_one_unresolved_per_session_uidx")
        .on(table.sessionId)
        .where(sql`resolved_at IS NULL`),
      orgIsolationPolicy("agent_pending_requests_org_isolation"),
    ]
  )
  .enableRLS();

export const agentUploads = agentSchema
  .table(
    "uploads",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      sessionId: uuid("session_id")
        .notNull()
        .references(() => agentSessions.id, { onDelete: "cascade" }),
      organizationId: text("organization_id").notNull(),
      uploadedByUserId: text("uploaded_by_user_id").notNull(),
      storageKey: text("storage_key").notNull(),
      sourceFilename: varchar("source_filename", { length: 255 }).notNull(),
      mediaType: varchar("media_type", { length: 120 }).notNull(),
      normalizedKind: varchar("normalized_kind", { length: 50 }).notNull(),
      manifest: jsonb("manifest").$type<unknown>().notNull(),
      createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (table) => [
      index("agent_uploads_session_id_idx").on(table.sessionId),
      index("agent_uploads_org_id_idx").on(table.organizationId),
      uniqueIndex("agent_uploads_storage_key_uidx").on(table.storageKey),
      orgIsolationPolicy("agent_uploads_org_isolation"),
    ]
  )
  .enableRLS();

export const agentToolCalls = agentSchema
  .table(
    "tool_calls",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      sessionId: uuid("session_id")
        .notNull()
        .references(() => agentSessions.id, { onDelete: "cascade" }),
      turnId: uuid("turn_id")
        .notNull()
        .references(() => agentTurns.id, { onDelete: "cascade" }),
      organizationId: text("organization_id").notNull(),
      toolName: varchar("tool_name", { length: 100 }).notNull(),
      status: varchar("status", { length: 32 }).notNull(),
      input: jsonb("input").$type<unknown>().notNull(),
      outputSummary: text("output_summary"),
      outputArtifactKey: text("output_artifact_key"),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      finishedAt: timestamp("finished_at"),
    },
    (table) => [
      index("agent_tool_calls_session_id_idx").on(table.sessionId),
      index("agent_tool_calls_turn_id_idx").on(table.turnId),
      index("agent_tool_calls_tool_name_idx").on(table.toolName),
      orgIsolationPolicy("agent_tool_calls_org_isolation"),
    ]
  )
  .enableRLS();
