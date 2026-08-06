CREATE SCHEMA IF NOT EXISTS "marketing";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "marketing"."experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"config" jsonb NOT NULL,
	"state" jsonb NOT NULL,
	"result" jsonb,
	"evaluate_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_experiments_status_check" CHECK ("marketing"."experiments"."status" IN ('draft', 'active', 'paused', 'completed'))
);
--> statement-breakpoint
ALTER TABLE "marketing"."experiments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "marketing"."experiments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "marketing"."mailboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"access_token_ciphertext" text NOT NULL,
	"refresh_token_ciphertext" text NOT NULL,
	"token_encryption_key_id" varchar(100) NOT NULL,
	"token_expires_at" timestamp with time zone NOT NULL,
	"history_id" text,
	"last_synced_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marketing"."mailboxes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "marketing"."mailboxes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales"."customer_activities" ADD COLUMN IF NOT EXISTS "marketing_experiment_id" uuid;--> statement-breakpoint
ALTER TABLE "sales"."customer_activities" ADD COLUMN IF NOT EXISTS "marketing_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "sales"."customer_activities" ADD COLUMN IF NOT EXISTS "marketing_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "sales"."customer_contacts" ADD COLUMN IF NOT EXISTS "outreach_suppressed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales"."customer_contacts" ADD COLUMN IF NOT EXISTS "outreach_suppression_reason" text;--> statement-breakpoint ALTER TABLE "marketing"."experiments" DROP CONSTRAINT IF EXISTS "experiments_created_by_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "marketing"."experiments" ADD CONSTRAINT "experiments_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "system"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint ALTER TABLE "marketing"."mailboxes" DROP CONSTRAINT IF EXISTS "mailboxes_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "marketing"."mailboxes" ADD CONSTRAINT "mailboxes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "system"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_experiments_org_status_idx" ON "marketing"."experiments" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "marketing_experiments_one_active_uidx" ON "marketing"."experiments" USING btree ("organization_id") WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "marketing_mailboxes_org_uidx" ON "marketing"."mailboxes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_mailboxes_user_idx" ON "marketing"."mailboxes" USING btree ("user_id");--> statement-breakpoint ALTER TABLE "sales"."customer_activities" DROP CONSTRAINT IF EXISTS "customer_activities_marketing_contact_id_customer_contacts_id_fk";--> statement-breakpoint
ALTER TABLE "sales"."customer_activities" ADD CONSTRAINT "customer_activities_marketing_contact_id_customer_contacts_id_fk" FOREIGN KEY ("marketing_contact_id") REFERENCES "sales"."customer_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_customer_activities_marketing_contact_uidx" ON "sales"."customer_activities" USING btree ("marketing_experiment_id","marketing_contact_id") WHERE marketing_experiment_id IS NOT NULL AND marketing_contact_id IS NOT NULL;--> statement-breakpoint DROP POLICY IF EXISTS "marketing_experiments_org_isolation" ON "marketing"."experiments";--> statement-breakpoint
CREATE POLICY "marketing_experiments_org_isolation" ON "marketing"."experiments" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint DROP POLICY IF EXISTS "marketing_mailboxes_org_isolation" ON "marketing"."mailboxes";--> statement-breakpoint
CREATE POLICY "marketing_mailboxes_org_isolation" ON "marketing"."mailboxes" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
GRANT USAGE ON SCHEMA "marketing" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "marketing"."experiments" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "marketing"."mailboxes" TO app_user;
