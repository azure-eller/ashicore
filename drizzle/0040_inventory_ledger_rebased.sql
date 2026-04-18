CREATE TABLE IF NOT EXISTS "inventory"."locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(40) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory"."locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory"."inventory_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" uuid NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"event_subtype" varchar(64),
	"item_id" uuid NOT NULL,
	"lot_id" uuid,
	"quantity" numeric(18, 4) NOT NULL,
	"unit_cost" numeric(18, 6),
	"extended_cost" numeric(18, 6),
	"reference_type" varchar(64),
	"reference_id" uuid,
	"parent_event_id" uuid,
	"idempotency_key" text,
	"actor_user_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb,
	CONSTRAINT "inventory_events_event_type_check" CHECK (event_type IN ('opening_balance', 'purchase_receipt', 'manufacturing_output', 'manual_adjustment_increase', 'stocktake_gain', 'manual_adjustment_decrease', 'stocktake_loss', 'sales_consumption', 'manufacturing_ingredient_consumption', 'unpick_restock', 'reservation_increase', 'reservation_release', 'expected_increase', 'expected_release', 'cost_basis_change', 'stocktake_verification')),
	CONSTRAINT "inventory_events_quantity_check" CHECK (CASE
          WHEN event_type IN ('stocktake_verification', 'cost_basis_change') THEN quantity = 0
          ELSE quantity > 0
        END),
	CONSTRAINT "inventory_events_lot_required_check" CHECK (event_type NOT IN ('opening_balance', 'purchase_receipt', 'manufacturing_output', 'manual_adjustment_increase', 'stocktake_gain', 'manual_adjustment_decrease', 'stocktake_loss', 'sales_consumption', 'manufacturing_ingredient_consumption', 'unpick_restock') OR lot_id IS NOT NULL),
	CONSTRAINT "inventory_events_cost_required_check" CHECK (event_type NOT IN ('opening_balance', 'purchase_receipt', 'manufacturing_output', 'manual_adjustment_increase', 'stocktake_gain', 'manual_adjustment_decrease', 'stocktake_loss', 'sales_consumption', 'manufacturing_ingredient_consumption', 'unpick_restock') OR (unit_cost IS NOT NULL AND extended_cost IS NOT NULL AND extended_cost = ROUND(quantity * unit_cost, 6))),
	CONSTRAINT "inventory_events_non_stock_cost_blank_check" CHECK (event_type NOT IN ('reservation_increase', 'reservation_release', 'expected_increase', 'expected_release', 'cost_basis_change', 'stocktake_verification') OR (lot_id IS NULL AND unit_cost IS NULL AND extended_cost IS NULL)),
	CONSTRAINT "inventory_events_stocktake_reference_check" CHECK (event_type NOT IN ('stocktake_gain', 'stocktake_loss', 'stocktake_verification') OR reference_type = 'stocktake_line')
);
--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory"."inventory_expected_summary" (
	"organization_id" text NOT NULL,
	"location_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"reference_type" varchar(64) NOT NULL,
	"reference_id" uuid NOT NULL,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_expected_summary_pk" PRIMARY KEY("organization_id","location_id","item_id","reference_type","reference_id")
);
--> statement-breakpoint
ALTER TABLE "inventory"."inventory_expected_summary" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory"."inventory_item_balances" (
	"organization_id" text NOT NULL,
	"location_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"on_hand_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"committed_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"expected_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"available_to_promise" numeric(18, 4) DEFAULT '0' NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_item_balances_pk" PRIMARY KEY("organization_id","location_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "inventory"."inventory_item_balances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory"."inventory_lot_balances" (
	"organization_id" text NOT NULL,
	"location_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(18, 6),
	"received_at" timestamp with time zone NOT NULL,
	"origin_event_id" uuid NOT NULL,
	"still_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_lot_balances_pk" PRIMARY KEY("organization_id","location_id","lot_id")
);
--> statement-breakpoint
ALTER TABLE "inventory"."inventory_lot_balances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory"."inventory_reservations_summary" (
	"organization_id" text NOT NULL,
	"location_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"reference_type" varchar(64) NOT NULL,
	"reference_id" uuid NOT NULL,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_reservations_summary_pk" PRIMARY KEY("organization_id","location_id","item_id","reference_type","reference_id")
);
--> statement-breakpoint
ALTER TABLE "inventory"."inventory_reservations_summary" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory"."inventory_idempotency_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"operation_name" text NOT NULL,
	"params_hash" text NOT NULL,
	"first_event_id" uuid,
	"result_envelope" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory"."inventory_idempotency_claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY "stock_movements_org_isolation" ON "inventory"."stock_movements" CASCADE;--> statement-breakpoint
DROP TABLE "inventory"."stock_movements" CASCADE;--> statement-breakpoint ALTER TABLE "inventory"."inventory_events" DROP CONSTRAINT IF EXISTS "inventory_events_location_id_locations_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" ADD CONSTRAINT "inventory_events_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "inventory"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint ALTER TABLE "inventory"."inventory_events" DROP CONSTRAINT IF EXISTS "inventory_events_item_id_items_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" ADD CONSTRAINT "inventory_events_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "inventory"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint ALTER TABLE "inventory"."inventory_events" DROP CONSTRAINT IF EXISTS "inventory_events_lot_id_lots_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" ADD CONSTRAINT "inventory_events_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "inventory"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint ALTER TABLE "inventory"."inventory_expected_summary" DROP CONSTRAINT IF EXISTS "inventory_expected_summary_location_id_locations_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_expected_summary" ADD CONSTRAINT "inventory_expected_summary_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "inventory"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint ALTER TABLE "inventory"."inventory_expected_summary" DROP CONSTRAINT IF EXISTS "inventory_expected_summary_item_id_items_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_expected_summary" ADD CONSTRAINT "inventory_expected_summary_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "inventory"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint ALTER TABLE "inventory"."inventory_item_balances" DROP CONSTRAINT IF EXISTS "inventory_item_balances_location_id_locations_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_item_balances" ADD CONSTRAINT "inventory_item_balances_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "inventory"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint ALTER TABLE "inventory"."inventory_item_balances" DROP CONSTRAINT IF EXISTS "inventory_item_balances_item_id_items_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_item_balances" ADD CONSTRAINT "inventory_item_balances_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "inventory"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint ALTER TABLE "inventory"."inventory_lot_balances" DROP CONSTRAINT IF EXISTS "inventory_lot_balances_location_id_locations_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_lot_balances" ADD CONSTRAINT "inventory_lot_balances_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "inventory"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint ALTER TABLE "inventory"."inventory_lot_balances" DROP CONSTRAINT IF EXISTS "inventory_lot_balances_lot_id_lots_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_lot_balances" ADD CONSTRAINT "inventory_lot_balances_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "inventory"."lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint ALTER TABLE "inventory"."inventory_lot_balances" DROP CONSTRAINT IF EXISTS "inventory_lot_balances_item_id_items_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_lot_balances" ADD CONSTRAINT "inventory_lot_balances_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "inventory"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint ALTER TABLE "inventory"."inventory_lot_balances" DROP CONSTRAINT IF EXISTS "inventory_lot_balances_origin_event_id_inventory_events_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_lot_balances" ADD CONSTRAINT "inventory_lot_balances_origin_event_id_inventory_events_id_fk" FOREIGN KEY ("origin_event_id") REFERENCES "inventory"."inventory_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint ALTER TABLE "inventory"."inventory_reservations_summary" DROP CONSTRAINT IF EXISTS "inventory_reservations_summary_location_id_locations_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_reservations_summary" ADD CONSTRAINT "inventory_reservations_summary_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "inventory"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint ALTER TABLE "inventory"."inventory_reservations_summary" DROP CONSTRAINT IF EXISTS "inventory_reservations_summary_item_id_items_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_reservations_summary" ADD CONSTRAINT "inventory_reservations_summary_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "inventory"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint ALTER TABLE "inventory"."inventory_idempotency_claims" DROP CONSTRAINT IF EXISTS "inventory_idempotency_claims_first_event_id_inventory_events_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_idempotency_claims" ADD CONSTRAINT "inventory_idempotency_claims_first_event_id_inventory_events_id_fk" FOREIGN KEY ("first_event_id") REFERENCES "inventory"."inventory_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_locations_org_idx" ON "inventory"."locations" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_locations_org_code_uidx" ON "inventory"."locations" USING btree ("organization_id","code") WHERE "inventory"."locations"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_locations_org_default_uidx" ON "inventory"."locations" USING btree ("organization_id","is_default") WHERE "inventory"."locations"."is_default" = true AND "inventory"."locations"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_events_org_item_occurred_idx" ON "inventory"."inventory_events" USING btree ("organization_id","location_id","item_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_events_org_lot_idx" ON "inventory"."inventory_events" USING btree ("organization_id","location_id","lot_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_events_org_reference_idx" ON "inventory"."inventory_events" USING btree ("organization_id","reference_type","reference_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_events_org_event_type_idx" ON "inventory"."inventory_events" USING btree ("organization_id","event_type","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_events_parent_event_idx" ON "inventory"."inventory_events" USING btree ("parent_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_events_idempotency_key_uidx" ON "inventory"."inventory_events" USING btree ("organization_id","idempotency_key") WHERE "inventory"."inventory_events"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_expected_summary_reference_idx" ON "inventory"."inventory_expected_summary" USING btree ("organization_id","reference_type","reference_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_lot_balances_item_idx" ON "inventory"."inventory_lot_balances" USING btree ("organization_id","location_id","item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_lot_balances_fifo_idx" ON "inventory"."inventory_lot_balances" USING btree ("organization_id","location_id","item_id","received_at","lot_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_reservations_summary_reference_idx" ON "inventory"."inventory_reservations_summary" USING btree ("organization_id","reference_type","reference_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_idempotency_claims_org_key_uidx" ON "inventory"."inventory_idempotency_claims" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_idempotency_claims_event_idx" ON "inventory"."inventory_idempotency_claims" USING btree ("first_event_id");--> statement-breakpoint
ALTER TABLE "inventory"."items" DROP COLUMN IF EXISTS "committed_qty";--> statement-breakpoint
ALTER TABLE "inventory"."items" DROP COLUMN IF EXISTS "expected_qty";--> statement-breakpoint
ALTER TABLE "inventory"."lots" DROP COLUMN IF EXISTS "cost_per_unit";--> statement-breakpoint DROP POLICY IF EXISTS "inventory_locations_org_isolation" ON "inventory"."locations";--> statement-breakpoint
CREATE POLICY "inventory_locations_org_isolation" ON "inventory"."locations" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint DROP POLICY IF EXISTS "inventory_events_org_isolation" ON "inventory"."inventory_events";--> statement-breakpoint
CREATE POLICY "inventory_events_org_isolation" ON "inventory"."inventory_events" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint DROP POLICY IF EXISTS "inventory_expected_summary_org_isolation" ON "inventory"."inventory_expected_summary";--> statement-breakpoint
CREATE POLICY "inventory_expected_summary_org_isolation" ON "inventory"."inventory_expected_summary" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint DROP POLICY IF EXISTS "inventory_item_balances_org_isolation" ON "inventory"."inventory_item_balances";--> statement-breakpoint
CREATE POLICY "inventory_item_balances_org_isolation" ON "inventory"."inventory_item_balances" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint DROP POLICY IF EXISTS "inventory_lot_balances_org_isolation" ON "inventory"."inventory_lot_balances";--> statement-breakpoint
CREATE POLICY "inventory_lot_balances_org_isolation" ON "inventory"."inventory_lot_balances" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint DROP POLICY IF EXISTS "inventory_reservations_summary_org_isolation" ON "inventory"."inventory_reservations_summary";--> statement-breakpoint
CREATE POLICY "inventory_reservations_summary_org_isolation" ON "inventory"."inventory_reservations_summary" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint DROP POLICY IF EXISTS "inventory_idempotency_claims_org_isolation" ON "inventory"."inventory_idempotency_claims";--> statement-breakpoint
CREATE POLICY "inventory_idempotency_claims_org_isolation" ON "inventory"."inventory_idempotency_claims" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));