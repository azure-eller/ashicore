import {
  index,
  jsonb,
  pgPolicy,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { inventorySchema } from "./units";
import { inventoryEvents } from "./inventory-events";

export const inventoryIdempotencyClaims = inventorySchema
  .table(
    "inventory_idempotency_claims",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      idempotencyKey: text("idempotency_key").notNull(),
      operationName: text("operation_name").notNull(),
      paramsHash: text("params_hash").notNull(),
      firstEventId: uuid("first_event_id").references(() => inventoryEvents.id),
      resultEnvelope: jsonb("result_envelope").$type<unknown>().notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      uniqueIndex("inventory_idempotency_claims_org_key_uidx").on(
        table.organizationId,
        table.idempotencyKey
      ),
      index("inventory_idempotency_claims_event_idx").on(table.firstEventId),
      pgPolicy("inventory_idempotency_claims_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();
