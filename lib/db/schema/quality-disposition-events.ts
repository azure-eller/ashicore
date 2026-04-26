import {
  check,
  index,
  numeric,
  pgPolicy,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { inventorySchema } from "./units";
import { items } from "./items";
import { lots } from "./lots";
import { inventoryEvents } from "./inventory-events";
import { inventoryLocations } from "./locations";

export const QUALITY_DISPOSITION_DECISIONS = [
  "release",
  "block",
  "reject",
  "scrap",
] as const;

export type QualityDispositionDecision =
  (typeof QUALITY_DISPOSITION_DECISIONS)[number];

export const qualityDispositionEvents = inventorySchema
  .table(
    "quality_disposition_events",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      locationId: uuid("location_id")
        .notNull()
        .references(() => inventoryLocations.id),
      itemId: uuid("item_id")
        .notNull()
        .references(() => items.id),
      lotId: uuid("lot_id")
        .notNull()
        .references(() => lots.id),
      inventoryEventId: uuid("inventory_event_id")
        .notNull()
        .references(() => inventoryEvents.id),
      decision: varchar("decision", { length: 32 }).notNull(),
      fromDisposition: varchar("from_disposition", { length: 24 }).notNull(),
      toDisposition: varchar("to_disposition", { length: 24 }),
      quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
      referenceType: varchar("reference_type", { length: 64 }),
      referenceId: uuid("reference_id"),
      notes: text("notes"),
      actorUserId: text("actor_user_id"),
      occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("quality_disposition_events_org_item_idx").on(
        table.organizationId,
        table.itemId,
        table.occurredAt
      ),
      index("quality_disposition_events_org_lot_idx").on(
        table.organizationId,
        table.lotId,
        table.occurredAt
      ),
      index("quality_disposition_events_inventory_event_idx").on(
        table.inventoryEventId
      ),
      check(
        "quality_disposition_events_decision_check",
        sql`decision IN ('release', 'block', 'reject', 'scrap')`
      ),
      check(
        "quality_disposition_events_disposition_check",
        sql`from_disposition IN ('available', 'blocked', 'rejected')
          AND (to_disposition IS NULL OR to_disposition IN ('available', 'blocked', 'rejected'))`
      ),
      check("quality_disposition_events_quantity_check", sql`quantity > 0`),
      pgPolicy("quality_disposition_events_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();
