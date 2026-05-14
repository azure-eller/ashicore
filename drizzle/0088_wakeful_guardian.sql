UPDATE "manufacturing"."manufacturing_orders"
SET "priority_rank" = NULL
WHERE "priority_rank" IS NOT NULL
  AND "status" <> 'released';--> statement-breakpoint
DROP INDEX IF EXISTS "manufacturing"."manufacturing_orders_active_priority_rank_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "manufacturing_orders_active_priority_rank_uidx" ON "manufacturing"."manufacturing_orders" USING btree ("organization_id","priority_rank") WHERE deleted_at IS NULL AND priority_rank IS NOT NULL AND status = 'released';
