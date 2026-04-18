import {
  boolean,
  index,
  numeric,
  pgPolicy,
  primaryKey,
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

export const inventoryLotBalances = inventorySchema
  .table(
    "inventory_lot_balances",
    {
      organizationId: text("organization_id").notNull(),
      locationId: uuid("location_id")
        .notNull()
        .references(() => inventoryLocations.id),
      lotId: uuid("lot_id")
        .notNull()
        .references(() => lots.id, { onDelete: "cascade" }),
      itemId: uuid("item_id")
        .notNull()
        .references(() => items.id),
      quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull().default("0"),
      unitCost: numeric("unit_cost", { precision: 18, scale: 6 }),
      receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
      originEventId: uuid("origin_event_id")
        .notNull()
        .references(() => inventoryEvents.id),
      stillActive: boolean("still_active").notNull().default(true),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      primaryKey({
        name: "inventory_lot_balances_pk",
        columns: [table.organizationId, table.locationId, table.lotId],
      }),
      index("inventory_lot_balances_item_idx").on(
        table.organizationId,
        table.locationId,
        table.itemId
      ),
      index("inventory_lot_balances_fifo_idx").on(
        table.organizationId,
        table.locationId,
        table.itemId,
        table.receivedAt,
        table.lotId
      ),
      pgPolicy("inventory_lot_balances_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const inventoryItemBalances = inventorySchema
  .table(
    "inventory_item_balances",
    {
      organizationId: text("organization_id").notNull(),
      locationId: uuid("location_id")
        .notNull()
        .references(() => inventoryLocations.id),
      itemId: uuid("item_id")
        .notNull()
        .references(() => items.id, { onDelete: "cascade" }),
      onHandQty: numeric("on_hand_qty", { precision: 18, scale: 4 }).notNull().default("0"),
      committedQty: numeric("committed_qty", { precision: 18, scale: 4 }).notNull().default("0"),
      expectedQty: numeric("expected_qty", { precision: 18, scale: 4 }).notNull().default("0"),
      availableToPromise: numeric("available_to_promise", {
        precision: 18,
        scale: 4,
      }).notNull().default("0"),
      lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      primaryKey({
        name: "inventory_item_balances_pk",
        columns: [table.organizationId, table.locationId, table.itemId],
      }),
      pgPolicy("inventory_item_balances_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const inventoryReservationsSummary = inventorySchema
  .table(
    "inventory_reservations_summary",
    {
      organizationId: text("organization_id").notNull(),
      locationId: uuid("location_id")
        .notNull()
        .references(() => inventoryLocations.id),
      itemId: uuid("item_id")
        .notNull()
        .references(() => items.id, { onDelete: "cascade" }),
      referenceType: varchar("reference_type", { length: 64 }).notNull(),
      referenceId: uuid("reference_id").notNull(),
      quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull().default("0"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      primaryKey({
        name: "inventory_reservations_summary_pk",
        columns: [
          table.organizationId,
          table.locationId,
          table.itemId,
          table.referenceType,
          table.referenceId,
        ],
      }),
      index("inventory_reservations_summary_reference_idx").on(
        table.organizationId,
        table.referenceType,
        table.referenceId
      ),
      pgPolicy("inventory_reservations_summary_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const inventoryExpectedSummary = inventorySchema
  .table(
    "inventory_expected_summary",
    {
      organizationId: text("organization_id").notNull(),
      locationId: uuid("location_id")
        .notNull()
        .references(() => inventoryLocations.id),
      itemId: uuid("item_id")
        .notNull()
        .references(() => items.id, { onDelete: "cascade" }),
      referenceType: varchar("reference_type", { length: 64 }).notNull(),
      referenceId: uuid("reference_id").notNull(),
      quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull().default("0"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      primaryKey({
        name: "inventory_expected_summary_pk",
        columns: [
          table.organizationId,
          table.locationId,
          table.itemId,
          table.referenceType,
          table.referenceId,
        ],
      }),
      index("inventory_expected_summary_reference_idx").on(
        table.organizationId,
        table.referenceType,
        table.referenceId
      ),
      pgPolicy("inventory_expected_summary_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();
