import {
  check,
  index,
  jsonb,
  numeric,
  pgPolicy,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { inventorySchema } from "./units";
import { items } from "./items";
import { lots } from "./lots";
import { inventoryLocations } from "./locations";

export const INVENTORY_EVENT_TYPES = [
  "opening_balance",
  "purchase_receipt",
  "manufacturing_output",
  "manual_adjustment_increase",
  "stocktake_gain",
  "manufacturing_variance_gain",
  "manual_adjustment_decrease",
  "stocktake_loss",
  "sales_consumption",
  "manufacturing_ingredient_consumption",
  "manufacturing_variance_loss",
  "unpick_restock",
  "reservation_increase",
  "reservation_release",
  "demand_increase",
  "demand_release",
  "expected_increase",
  "expected_release",
  "cost_basis_change",
  "stocktake_verification",
] as const;

export type InventoryEventType = (typeof INVENTORY_EVENT_TYPES)[number];

export const inventoryEvents = inventorySchema
  .table(
    "inventory_events",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      locationId: uuid("location_id")
        .notNull()
        .references(() => inventoryLocations.id),
      eventType: varchar("event_type", { length: 64 }).notNull(),
      eventSubtype: varchar("event_subtype", { length: 64 }),
      itemId: uuid("item_id")
        .notNull()
        .references(() => items.id),
      lotId: uuid("lot_id").references(() => lots.id),
      quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
      unitCost: numeric("unit_cost", { precision: 18, scale: 6 }),
      extendedCost: numeric("extended_cost", { precision: 18, scale: 6 }),
      referenceType: varchar("reference_type", { length: 64 }),
      referenceId: uuid("reference_id"),
      parentEventId: uuid("parent_event_id"),
      idempotencyKey: text("idempotency_key"),
      actorUserId: text("actor_user_id"),
      occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
      metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
    },
    (table) => [
      index("inventory_events_org_item_occurred_idx").on(
        table.organizationId,
        table.locationId,
        table.itemId,
        table.occurredAt
      ),
      index("inventory_events_org_lot_idx").on(
        table.organizationId,
        table.locationId,
        table.lotId
      ),
      index("inventory_events_org_reference_idx").on(
        table.organizationId,
        table.referenceType,
        table.referenceId
      ),
      index("inventory_events_org_event_type_idx").on(
        table.organizationId,
        table.eventType,
        table.occurredAt
      ),
      index("inventory_events_parent_event_idx").on(table.parentEventId),
      uniqueIndex("inventory_events_idempotency_key_uidx")
        .on(table.organizationId, table.idempotencyKey)
        .where(sql`${table.idempotencyKey} IS NOT NULL`),
      check(
        "inventory_events_event_type_check",
        sql`event_type IN ('opening_balance', 'purchase_receipt', 'manufacturing_output', 'manual_adjustment_increase', 'stocktake_gain', 'manufacturing_variance_gain', 'manual_adjustment_decrease', 'stocktake_loss', 'sales_consumption', 'manufacturing_ingredient_consumption', 'manufacturing_variance_loss', 'unpick_restock', 'reservation_increase', 'reservation_release', 'demand_increase', 'demand_release', 'expected_increase', 'expected_release', 'cost_basis_change', 'stocktake_verification')`
      ),
      check(
        "inventory_events_quantity_check",
        sql`CASE
          WHEN event_type IN ('stocktake_verification', 'cost_basis_change') THEN quantity = 0
          ELSE quantity > 0
        END`
      ),
      check(
        "inventory_events_lot_required_check",
        sql`event_type NOT IN ('opening_balance', 'purchase_receipt', 'manufacturing_output', 'manual_adjustment_increase', 'stocktake_gain', 'manufacturing_variance_gain', 'manual_adjustment_decrease', 'stocktake_loss', 'sales_consumption', 'manufacturing_ingredient_consumption', 'manufacturing_variance_loss', 'unpick_restock') OR lot_id IS NOT NULL`
      ),
      check(
        "inventory_events_cost_required_check",
        sql`event_type NOT IN ('opening_balance', 'purchase_receipt', 'manufacturing_output', 'manual_adjustment_increase', 'stocktake_gain', 'manufacturing_variance_gain', 'manual_adjustment_decrease', 'stocktake_loss', 'sales_consumption', 'manufacturing_ingredient_consumption', 'manufacturing_variance_loss', 'unpick_restock') OR (unit_cost IS NOT NULL AND extended_cost IS NOT NULL AND extended_cost = ROUND(quantity * unit_cost, 6))`
      ),
      check(
        "inventory_events_non_stock_cost_blank_check",
        sql`event_type NOT IN ('reservation_increase', 'reservation_release', 'demand_increase', 'demand_release', 'expected_increase', 'expected_release', 'cost_basis_change', 'stocktake_verification') OR (lot_id IS NULL AND unit_cost IS NULL AND extended_cost IS NULL)`
      ),
      check(
        "inventory_events_stocktake_reference_check",
        sql`event_type NOT IN ('stocktake_gain', 'stocktake_loss', 'stocktake_verification') OR reference_type = 'stocktake_line'`
      ),
      pgPolicy("inventory_events_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();
