import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgSchema,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  date,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import type { DailyManufacturingReportScheduleConfig } from "../../reports/daily-manufacturing-config";

export const reportingSchema = pgSchema("reporting");

export const reportSchedules = reportingSchema
  .table(
    "report_schedules",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organization.id, { onDelete: "cascade" }),
      reportType: varchar("report_type", { length: 64 }).notNull(),
      enabled: boolean("enabled").notNull().default(false),
      emailEnabled: boolean("email_enabled").notNull().default(true),
      localSendTime: time("local_send_time").notNull().default("17:00:00"),
      timeZone: text("time_zone").notNull().default("America/Denver"),
      config: jsonb("config")
        .$type<DailyManufacturingReportScheduleConfig>()
        .notNull()
        .default(sql`'{}'::jsonb`),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date()),
    },
    (table) => [
      uniqueIndex("report_schedules_org_type_uidx").on(
        table.organizationId,
        table.reportType
      ),
      index("report_schedules_enabled_idx").on(table.enabled),
      check(
        "report_schedules_report_type_check",
        sql`${table.reportType} IN ('daily_manufacturing')`
      ),
      pgPolicy("report_schedules_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const reportRecipients = reportingSchema
  .table(
    "report_recipients",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organization.id, { onDelete: "cascade" }),
      scheduleId: uuid("schedule_id")
        .notNull()
        .references(() => reportSchedules.id, { onDelete: "cascade" }),
      userId: text("user_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      uniqueIndex("report_recipients_schedule_user_uidx").on(
        table.scheduleId,
        table.userId
      ),
      index("report_recipients_org_idx").on(table.organizationId),
      pgPolicy("report_recipients_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const reportRuns = reportingSchema
  .table(
    "report_runs",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organization.id, { onDelete: "cascade" }),
      reportType: varchar("report_type", { length: 64 }).notNull(),
      reportDate: date("report_date", { mode: "string" }).notNull(),
      timeZone: text("time_zone").notNull(),
      windowStartAt: timestamp("window_start_at", { withTimezone: true }).notNull(),
      windowEndAt: timestamp("window_end_at", { withTimezone: true }).notNull(),
      payloadVersion: integer("payload_version").notNull().default(1),
      payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
      status: varchar("status", { length: 24 }).notNull().default("generating"),
      emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
      failureMessage: text("failure_message"),
      claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date()),
    },
    (table) => [
      uniqueIndex("report_runs_org_type_date_uidx").on(
        table.organizationId,
        table.reportType,
        table.reportDate
      ),
      index("report_runs_org_type_created_idx").on(
        table.organizationId,
        table.reportType,
        table.createdAt
      ),
      check(
        "report_runs_report_type_check",
        sql`${table.reportType} IN ('daily_manufacturing')`
      ),
      check(
        "report_runs_status_check",
        sql`${table.status} IN ('generating', 'generated', 'sent', 'failed')`
      ),
      check("report_runs_payload_version_check", sql`${table.payloadVersion} > 0`),
      pgPolicy("report_runs_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const notifications = reportingSchema
  .table(
    "notifications",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organization.id, { onDelete: "cascade" }),
      userId: text("user_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),
      type: varchar("type", { length: 64 }).notNull(),
      title: varchar("title", { length: 255 }).notNull(),
      body: text("body").notNull(),
      entityType: varchar("entity_type", { length: 64 }).notNull(),
      entityId: text("entity_id").notNull(),
      deliveryStatus: varchar("delivery_status", { length: 32 }).notNull().default("created"),
      readAt: timestamp("read_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date()),
    },
    (table) => [
      index("notifications_user_created_idx").on(table.userId, table.createdAt),
      index("notifications_org_user_read_idx").on(
        table.organizationId,
        table.userId,
        table.readAt
      ),
      index("notifications_entity_idx").on(table.entityType, table.entityId),
      check(
        "notifications_type_check",
        sql`${table.type} IN ('daily_manufacturing_report', 'manufacturing_order_created', 'manufacturing_order_completed', 'purchase_order_received')`
      ),
      check(
        "notifications_entity_type_check",
        sql`${table.entityType} IN ('report_run', 'manufacturing_order', 'purchase_order')`
      ),
      check(
        "notifications_delivery_status_check",
        sql`${table.deliveryStatus} IN ('created', 'delivered', 'failed')`
      ),
      pgPolicy("notifications_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const notificationPreferences = reportingSchema
  .table(
    "notification_preferences",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organization.id, { onDelete: "cascade" }),
      userId: text("user_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),
      eventType: varchar("event_type", { length: 64 }).notNull(),
      enabled: boolean("enabled").notNull().default(false),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date()),
    },
    (table) => [
      uniqueIndex("notification_preferences_org_user_event_uidx").on(
        table.organizationId,
        table.userId,
        table.eventType
      ),
      check(
        "notification_preferences_event_type_check",
        sql`${table.eventType} IN ('manufacturing_order_created', 'manufacturing_order_completed', 'purchase_order_received')`
      ),
      pgPolicy("notification_preferences_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

// User-scoped like auth sessions: a phone belongs to a person; the org lives on
// the notification row.
export const pushDevices = reportingSchema
  .table(
    "push_devices",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      userId: text("user_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),
      fcmToken: text("fcm_token").notNull(),
      platform: varchar("platform", { length: 16 }).notNull().default("android"),
      lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date()),
    },
    (table) => [
      uniqueIndex("push_devices_token_uidx").on(table.fcmToken),
      index("push_devices_user_idx").on(table.userId),
      check("push_devices_platform_check", sql`${table.platform} IN ('android')`),
      pgPolicy("push_devices_select_own", {
        for: "select",
        to: "public",
        using: sql`user_id = current_setting('app.current_user_id', true) OR fcm_token = current_setting('app.current_fcm_token', true)`,
      }),
      pgPolicy("push_devices_insert_own", {
        for: "insert",
        to: "public",
        withCheck: sql`user_id = current_setting('app.current_user_id', true)`,
      }),
      pgPolicy("push_devices_reassign_to_current_user", {
        for: "update",
        to: "public",
        using: sql`fcm_token = current_setting('app.current_fcm_token', true)`,
        withCheck: sql`user_id = current_setting('app.current_user_id', true)`,
      }),
      pgPolicy("push_devices_delete_own", {
        for: "delete",
        to: "public",
        using: sql`user_id = current_setting('app.current_user_id', true)`,
      }),
    ]
  )
  .enableRLS();
