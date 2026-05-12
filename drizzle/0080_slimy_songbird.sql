CREATE TABLE IF NOT EXISTS "inventory"."stocktake_lot_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stocktake_item_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"lot_number" varchar(128) NOT NULL,
	"expected_qty" numeric(12, 4) NOT NULL,
	"counted_qty" numeric(12, 4),
	"variance_qty" numeric(12, 4),
	"applied_delta_qty" numeric(12, 4),
	"received_at" timestamp with time zone NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory"."stocktake_lot_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory"."stocktake_lot_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint ALTER TABLE "inventory"."stocktake_lot_items" DROP CONSTRAINT IF EXISTS "stocktake_lot_items_stocktake_item_id_stocktake_items_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."stocktake_lot_items" ADD CONSTRAINT "stocktake_lot_items_stocktake_item_id_stocktake_items_id_fk" FOREIGN KEY ("stocktake_item_id") REFERENCES "inventory"."stocktake_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint ALTER TABLE "inventory"."stocktake_lot_items" DROP CONSTRAINT IF EXISTS "stocktake_lot_items_lot_id_lots_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."stocktake_lot_items" ADD CONSTRAINT "stocktake_lot_items_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "inventory"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stocktake_lot_items_stocktake_item_id_idx" ON "inventory"."stocktake_lot_items" USING btree ("stocktake_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stocktake_lot_items_lot_id_idx" ON "inventory"."stocktake_lot_items" USING btree ("lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stocktake_lot_items_stocktake_item_lot_uidx" ON "inventory"."stocktake_lot_items" USING btree ("stocktake_item_id","lot_id");--> statement-breakpoint
DROP POLICY IF EXISTS "stocktake_lot_items_org_isolation" ON "inventory"."stocktake_lot_items";--> statement-breakpoint
CREATE POLICY "stocktake_lot_items_org_isolation" ON "inventory"."stocktake_lot_items" AS PERMISSIVE FOR ALL TO public USING (stocktake_item_id IN (
          SELECT si.id
          FROM inventory.stocktake_items si
          INNER JOIN inventory.stocktakes s ON s.id = si.stocktake_id
          WHERE s.organization_id = current_setting('app.current_org_id', true)
        )) WITH CHECK (stocktake_item_id IN (
          SELECT si.id
          FROM inventory.stocktake_items si
          INNER JOIN inventory.stocktakes s ON s.id = si.stocktake_id
          WHERE s.organization_id = current_setting('app.current_org_id', true)
        ));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."stocktake_lot_items" TO app_user;
