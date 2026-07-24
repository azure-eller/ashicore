CREATE TABLE IF NOT EXISTS "settings"."organization_overhead_settings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"overhead_percent" numeric(7, 4),
	"period_start" date,
	"period_end" date,
	"overhead_pool" numeric(14, 2),
	"revenue_total" numeric(14, 2),
	"derivation" jsonb,
	"account_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settings"."organization_overhead_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint DROP POLICY IF EXISTS "organization_overhead_settings_org_isolation" ON "settings"."organization_overhead_settings";--> statement-breakpoint
CREATE POLICY "organization_overhead_settings_org_isolation" ON "settings"."organization_overhead_settings" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
ALTER TABLE "settings"."organization_overhead_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "settings"."organization_overhead_settings" TO app_user;