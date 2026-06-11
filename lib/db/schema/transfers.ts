import {
  index,
  integer,
  numeric,
  pgPolicy,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { items } from "./items";
import { inventoryLocations } from "./locations";
import { inventorySchema } from "./units";

export const inventoryTransfers = inventorySchema
  .table(
    "transfers",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      fromLocationId: uuid("from_location_id")
        .notNull()
        .references(() => inventoryLocations.id),
      toLocationId: uuid("to_location_id")
        .notNull()
        .references(() => inventoryLocations.id),
      note: text("note"),
      createdByUserId: text("created_by_user_id"),
      occurredAt: timestamp("occurred_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
      createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      index("inventory_transfers_org_idx").on(table.organizationId),
      index("inventory_transfers_org_occurred_idx").on(
        table.organizationId,
        table.occurredAt
      ),
      pgPolicy("inventory_transfers_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const inventoryTransferLines = inventorySchema
  .table(
    "transfer_lines",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      transferId: uuid("transfer_id")
        .notNull()
        .references(() => inventoryTransfers.id),
      itemId: uuid("item_id")
        .notNull()
        .references(() => items.id),
      quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
      sortOrder: integer("sort_order").notNull().default(0),
      createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      index("inventory_transfer_lines_transfer_id_idx").on(table.transferId),
      index("inventory_transfer_lines_item_id_idx").on(table.itemId),
      pgPolicy("inventory_transfer_lines_org_isolation", {
        for: "all",
        to: "public",
        using: sql`transfer_id IN (
          SELECT id
          FROM inventory.transfers
          WHERE organization_id = current_setting('app.current_org_id', true)
        )`,
        withCheck: sql`transfer_id IN (
          SELECT id
          FROM inventory.transfers
          WHERE organization_id = current_setting('app.current_org_id', true)
        )`,
      }),
    ]
  )
  .enableRLS();
