CREATE TABLE "inventory"."stocktake_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stocktake_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"item_name" varchar(255) NOT NULL,
	"item_sku" varchar(50),
	"item_type" varchar(20) NOT NULL,
	"unit_name" varchar(50) NOT NULL,
	"expected_qty" numeric(12, 4) NOT NULL,
	"counted_qty" numeric(12, 4),
	"variance_qty" numeric(12, 4),
	"applied_delta_qty" numeric(12, 4),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory"."stocktake_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory"."stocktake_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory"."stocktakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"scope" varchar(20) DEFAULT 'all' NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory"."stocktakes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory"."stocktakes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory"."stocktake_items" ADD CONSTRAINT "stocktake_items_stocktake_id_stocktakes_id_fk" FOREIGN KEY ("stocktake_id") REFERENCES "inventory"."stocktakes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory"."stocktake_items" ADD CONSTRAINT "stocktake_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "inventory"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stocktake_items_stocktake_id_idx" ON "inventory"."stocktake_items" USING btree ("stocktake_id");--> statement-breakpoint
CREATE INDEX "stocktake_items_item_id_idx" ON "inventory"."stocktake_items" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stocktake_items_stocktake_item_uidx" ON "inventory"."stocktake_items" USING btree ("stocktake_id","item_id");--> statement-breakpoint
CREATE INDEX "stocktakes_org_id_idx" ON "inventory"."stocktakes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "stocktakes_status_idx" ON "inventory"."stocktakes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "stocktakes_created_at_idx" ON "inventory"."stocktakes" USING btree ("created_at");--> statement-breakpoint
CREATE POLICY "stocktake_items_org_isolation" ON "inventory"."stocktake_items" AS PERMISSIVE FOR ALL TO public USING (stocktake_id IN (
          SELECT id
          FROM inventory.stocktakes
          WHERE organization_id = current_setting('app.current_org_id', true)
        )) WITH CHECK (stocktake_id IN (
          SELECT id
          FROM inventory.stocktakes
          WHERE organization_id = current_setting('app.current_org_id', true)
        ));--> statement-breakpoint
CREATE POLICY "stocktakes_org_isolation" ON "inventory"."stocktakes" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."stocktakes" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."stocktake_items" TO app_user;
