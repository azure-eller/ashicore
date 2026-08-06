import { sql } from "drizzle-orm";
import {
  check,
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
import type {
  MarketingExperimentConfig,
  MarketingExperimentResult,
  MarketingExperimentState,
} from "@/lib/schemas/marketing";
import { user } from "./auth";

export const marketingSchema = pgSchema("marketing");

export const marketingExperiments = marketingSchema
  .table(
    "experiments",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      status: varchar("status", { length: 20 }).notNull().default("draft"),
      config: jsonb("config").$type<MarketingExperimentConfig>().notNull(),
      state: jsonb("state").$type<MarketingExperimentState>().notNull(),
      result: jsonb("result").$type<MarketingExperimentResult>(),
      evaluateAt: timestamp("evaluate_at", { withTimezone: true }),
      createdByUserId: text("created_by_user_id")
        .notNull()
        .references(() => user.id),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("marketing_experiments_org_status_idx").on(
        table.organizationId,
        table.status,
      ),
      uniqueIndex("marketing_experiments_one_active_uidx")
        .on(table.organizationId)
        .where(sql`status = 'active'`),
      check(
        "marketing_experiments_status_check",
        sql`${table.status} IN ('draft', 'active', 'paused', 'completed')`,
      ),
      pgPolicy("marketing_experiments_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ],
  )
  .enableRLS();

export const marketingMailboxes = marketingSchema
  .table(
    "mailboxes",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      userId: text("user_id")
        .notNull()
        .references(() => user.id),
      email: text("email").notNull(),
      accessTokenCiphertext: text("access_token_ciphertext").notNull(),
      refreshTokenCiphertext: text("refresh_token_ciphertext").notNull(),
      tokenEncryptionKeyId: varchar("token_encryption_key_id", {
        length: 100,
      }).notNull(),
      tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }).notNull(),
      historyId: text("history_id"),
      lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
      disabledAt: timestamp("disabled_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      uniqueIndex("marketing_mailboxes_org_uidx").on(table.organizationId),
      index("marketing_mailboxes_user_idx").on(table.userId),
      pgPolicy("marketing_mailboxes_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ],
  )
  .enableRLS();
