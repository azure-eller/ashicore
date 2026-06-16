import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgPolicy,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { systemSchema } from "./auth";
import { salesOrders } from "./sales";

export const billingUsageEvents = systemSchema
  .table(
    "billing_usage_events",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      salesOrderId: uuid("sales_order_id")
        .notNull()
        .references(() => salesOrders.id),
      eventType: varchar("event_type", { length: 40 })
        .notNull()
        .default("sales_order_shipped"),
      billingPeriodStart: timestamp("billing_period_start", {
        withTimezone: true,
      }).notNull(),
      billingPeriodEnd: timestamp("billing_period_end", {
        withTimezone: true,
      }).notNull(),
      occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      uniqueIndex("billing_usage_events_order_period_uidx").on(
        table.organizationId,
        table.salesOrderId,
        table.eventType,
        table.billingPeriodStart
      ),
      index("billing_usage_events_org_period_idx").on(
        table.organizationId,
        table.billingPeriodStart,
        table.billingPeriodEnd
      ),
      pgPolicy("billing_usage_events_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const billingPeriodAdjustments = systemSchema
  .table(
    "billing_period_adjustments",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      billingPeriodStart: timestamp("billing_period_start", {
        withTimezone: true,
      }).notNull(),
      billingPeriodEnd: timestamp("billing_period_end", {
        withTimezone: true,
      }).notNull(),
      fromBand: varchar("from_band", { length: 20 }).notNull(),
      toBand: varchar("to_band", { length: 20 }).notNull(),
      amountCents: integer("amount_cents").notNull(),
      status: varchar("status", { length: 20 }).notNull().default("pending"),
      stripeInvoiceItemId: text("stripe_invoice_item_id"),
      stripeInvoiceId: text("stripe_invoice_id"),
      idempotencyKey: text("idempotency_key").notNull(),
      retryAttempts: integer("retry_attempts").notNull().default(0),
      nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
      error: text("error"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      uniqueIndex("billing_period_adjustments_idempotency_uidx").on(
        table.idempotencyKey
      ),
      uniqueIndex("billing_period_adjustments_org_period_band_uidx").on(
        table.organizationId,
        table.billingPeriodStart,
        table.toBand
      ),
      index("billing_period_adjustments_org_status_idx").on(
        table.organizationId,
        table.status
      ),
      pgPolicy("billing_period_adjustments_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();
