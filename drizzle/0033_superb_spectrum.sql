CREATE TABLE IF NOT EXISTS "manufacturing"."manufacturing_order_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manufacturing_order_id" uuid NOT NULL,
	"batch_number" integer NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"planned_quantity" numeric(12, 4) NOT NULL,
	"actual_quantity" numeric(12, 4),
	"started_at" timestamp,
	"picked_at" timestamp,
	"completed_at" timestamp,
	"lot_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "manufacturing_order_batches_manufacturing_order_id_manufacturing_orders_id_fk" FOREIGN KEY ("manufacturing_order_id") REFERENCES "manufacturing"."manufacturing_orders"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "manufacturing_order_batches_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "inventory"."lots"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_batches" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_batches" ADD COLUMN IF NOT EXISTS "started_at" timestamp;--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_batches" ADD COLUMN IF NOT EXISTS "picked_at" timestamp;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "manufacturing"."manufacturing_pick_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manufacturing_order_ingredient_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"quantity_used" numeric(12, 4) NOT NULL,
	"cost_per_unit" numeric(12, 4),
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "manufacturing_pick_allocations_manufacturing_order_ingredient_id_manufacturing_order_ingredients_id_fk" FOREIGN KEY ("manufacturing_order_ingredient_id") REFERENCES "manufacturing"."manufacturing_order_ingredients"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "manufacturing_pick_allocations_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "inventory"."lots"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_pick_allocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_pick_allocations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX IF EXISTS "manufacturing"."manufacturing_order_ingredients_order_item_uidx";--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients" ADD COLUMN IF NOT EXISTS "manufacturing_order_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients" ADD COLUMN IF NOT EXISTS "picked_quantity" numeric(12, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients" ADD COLUMN IF NOT EXISTS "pick_status" varchar(20) DEFAULT 'not_picked' NOT NULL;--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients" ADD COLUMN IF NOT EXISTS "picked_at" timestamp;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'manufacturing_order_ingredients_manufacturing_order_batch_id_manufacturing_order_batches_id_fk'
			AND conrelid = 'manufacturing.manufacturing_order_ingredients'::regclass
	) THEN
		ALTER TABLE "manufacturing"."manufacturing_order_ingredients"
			ADD CONSTRAINT "manufacturing_order_ingredients_manufacturing_order_batch_id_manufacturing_order_batches_id_fk"
			FOREIGN KEY ("manufacturing_order_batch_id") REFERENCES "manufacturing"."manufacturing_order_batches"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "manufacturing_order_batches_order_id_idx" ON "manufacturing"."manufacturing_order_batches" USING btree ("manufacturing_order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "manufacturing_order_batches_status_idx" ON "manufacturing"."manufacturing_order_batches" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "manufacturing_order_batches_order_batch_uidx" ON "manufacturing"."manufacturing_order_batches" USING btree ("manufacturing_order_id","batch_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "manufacturing_pick_allocations_ingredient_id_idx" ON "manufacturing"."manufacturing_pick_allocations" USING btree ("manufacturing_order_ingredient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "manufacturing_order_ingredients_batch_id_idx" ON "manufacturing"."manufacturing_order_ingredients" USING btree ("manufacturing_order_batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "manufacturing_order_ingredients_template_item_uidx" ON "manufacturing"."manufacturing_order_ingredients" USING btree ("manufacturing_order_id","item_id") WHERE "manufacturing"."manufacturing_order_ingredients"."manufacturing_order_batch_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "manufacturing_order_ingredients_batch_item_uidx" ON "manufacturing"."manufacturing_order_ingredients" USING btree ("manufacturing_order_batch_id","item_id") WHERE "manufacturing"."manufacturing_order_ingredients"."manufacturing_order_batch_id" IS NOT NULL;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'manufacturing'
			AND tablename = 'manufacturing_order_batches'
			AND policyname = 'manufacturing_order_batches_org_isolation'
	) THEN
		CREATE POLICY "manufacturing_order_batches_org_isolation" ON "manufacturing"."manufacturing_order_batches" AS PERMISSIVE FOR ALL TO public USING (manufacturing_order_id IN (
		          SELECT id
		          FROM manufacturing.manufacturing_orders
		          WHERE organization_id = current_setting('app.current_org_id', true)
		        )) WITH CHECK (manufacturing_order_id IN (
		          SELECT id
		          FROM manufacturing.manufacturing_orders
		          WHERE organization_id = current_setting('app.current_org_id', true)
		        ));
	END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'manufacturing'
			AND tablename = 'manufacturing_pick_allocations'
			AND policyname = 'manufacturing_pick_allocations_org_isolation'
	) THEN
		CREATE POLICY "manufacturing_pick_allocations_org_isolation" ON "manufacturing"."manufacturing_pick_allocations" AS PERMISSIVE FOR ALL TO public USING (manufacturing_order_ingredient_id IN (
		          SELECT i.id
		          FROM manufacturing.manufacturing_order_ingredients i
		          INNER JOIN manufacturing.manufacturing_orders o
		            ON o.id = i.manufacturing_order_id
		          WHERE o.organization_id = current_setting('app.current_org_id', true)
		        )) WITH CHECK (manufacturing_order_ingredient_id IN (
		          SELECT i.id
		          FROM manufacturing.manufacturing_order_ingredients i
		          INNER JOIN manufacturing.manufacturing_orders o
		            ON o.id = i.manufacturing_order_id
		          WHERE o.organization_id = current_setting('app.current_org_id', true)
		        ));
	END IF;
END $$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manufacturing"."manufacturing_order_batches" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manufacturing"."manufacturing_pick_allocations" TO app_user;
