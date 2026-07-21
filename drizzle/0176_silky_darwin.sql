CREATE TABLE IF NOT EXISTS "sales"."pricing_scenario_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"scenario_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"note" text,
	"snapshot" jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales"."pricing_scenario_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales"."pricing_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" varchar(120) NOT NULL,
	"doc" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"deleted_by_user_id" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales"."pricing_scenarios" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint ALTER TABLE "sales"."pricing_scenario_revisions" DROP CONSTRAINT IF EXISTS "pricing_scenario_revisions_scenario_id_pricing_scenarios_id_fk";--> statement-breakpoint
ALTER TABLE "sales"."pricing_scenario_revisions" ADD CONSTRAINT "pricing_scenario_revisions_scenario_id_pricing_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "sales"."pricing_scenarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_pricing_scenario_revisions_number_uidx" ON "sales"."pricing_scenario_revisions" USING btree ("scenario_id","revision_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_pricing_scenario_revisions_org_idx" ON "sales"."pricing_scenario_revisions" USING btree ("organization_id","scenario_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_pricing_scenarios_active_idx" ON "sales"."pricing_scenarios" USING btree ("organization_id","updated_at") WHERE deleted_at IS NULL;--> statement-breakpoint DROP POLICY IF EXISTS "sales_pricing_scenario_revisions_org_isolation" ON "sales"."pricing_scenario_revisions";--> statement-breakpoint
CREATE POLICY "sales_pricing_scenario_revisions_org_isolation" ON "sales"."pricing_scenario_revisions" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint DROP POLICY IF EXISTS "sales_pricing_scenarios_org_isolation" ON "sales"."pricing_scenarios";--> statement-breakpoint
CREATE POLICY "sales_pricing_scenarios_org_isolation" ON "sales"."pricing_scenarios" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
ALTER TABLE "sales"."pricing_scenarios" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales"."pricing_scenario_revisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE "sales"."pricing_scenario_revisions" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "sales"."pricing_scenario_revisions" TO app_user;--> statement-breakpoint
REVOKE DELETE ON TABLE "sales"."pricing_scenarios" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "sales"."pricing_scenarios" TO app_user;
