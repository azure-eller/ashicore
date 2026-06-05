DO $$ BEGIN
 CREATE TYPE "inventory"."adjustment_reason" AS ENUM('cycle_count', 'found_stock', 'damaged_spoiled', 'data_correction', 'other');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
CREATE TABLE IF NOT EXISTS "inventory"."inventory_event_adjustment_reasons" (
	"inventory_event_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"reason" "inventory"."adjustment_reason" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "inventory"."inventory_event_adjustment_reasons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory"."inventory_event_adjustment_reasons" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 ALTER TABLE "inventory"."inventory_event_adjustment_reasons" ADD CONSTRAINT "inventory_event_adjustment_reasons_inventory_event_id_inventory_events_id_fk" FOREIGN KEY ("inventory_event_id") REFERENCES "inventory"."inventory_events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
CREATE INDEX IF NOT EXISTS "inventory_event_adjustment_reasons_org_reason_idx" ON "inventory"."inventory_event_adjustment_reasons" USING btree ("organization_id","reason");
DO $$ BEGIN
 CREATE POLICY "inventory_event_adjustment_reasons_org_isolation" ON "inventory"."inventory_event_adjustment_reasons" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."inventory_event_adjustment_reasons" TO app_user;
