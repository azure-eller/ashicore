CREATE TABLE IF NOT EXISTS "reporting"."notification_resource_exclusions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"resource_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_resource_exclusions_event_type_check" CHECK ("reporting"."notification_resource_exclusions"."event_type" IN ('manufacturing_order_created'))
);
--> statement-breakpoint
ALTER TABLE "reporting"."notification_resource_exclusions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint ALTER TABLE "reporting"."notification_resource_exclusions" DROP CONSTRAINT IF EXISTS "notification_resource_exclusions_organization_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "reporting"."notification_resource_exclusions" ADD CONSTRAINT "notification_resource_exclusions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "system"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint ALTER TABLE "reporting"."notification_resource_exclusions" DROP CONSTRAINT IF EXISTS "notification_resource_exclusions_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "reporting"."notification_resource_exclusions" ADD CONSTRAINT "notification_resource_exclusions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "system"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint ALTER TABLE "reporting"."notification_resource_exclusions" DROP CONSTRAINT IF EXISTS "notification_resource_exclusions_resource_id_resources_id_fk";--> statement-breakpoint
ALTER TABLE "reporting"."notification_resource_exclusions" ADD CONSTRAINT "notification_resource_exclusions_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "manufacturing"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notification_resource_exclusions_org_user_event_resource_uidx" ON "reporting"."notification_resource_exclusions" USING btree ("organization_id","user_id","event_type","resource_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_resource_exclusions_org_event_resource_idx" ON "reporting"."notification_resource_exclusions" USING btree ("organization_id","event_type","resource_id");--> statement-breakpoint DROP POLICY IF EXISTS "notification_resource_exclusions_org_isolation" ON "reporting"."notification_resource_exclusions";--> statement-breakpoint
CREATE POLICY "notification_resource_exclusions_org_isolation" ON "reporting"."notification_resource_exclusions" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
ALTER TABLE "reporting"."notification_resource_exclusions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "reporting"."notification_resource_exclusions" TO app_user;
