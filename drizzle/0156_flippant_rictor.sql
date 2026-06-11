CREATE TABLE IF NOT EXISTS "reporting"."notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_event_type_check" CHECK ("reporting"."notification_preferences"."event_type" IN ('manufacturing_order_created'))
);
--> statement-breakpoint
ALTER TABLE "reporting"."notification_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reporting"."push_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"fcm_token" text NOT NULL,
	"platform" varchar(16) DEFAULT 'android' NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_devices_platform_check" CHECK ("reporting"."push_devices"."platform" IN ('android'))
);
--> statement-breakpoint
ALTER TABLE "reporting"."push_devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reporting"."notifications" DROP CONSTRAINT "notifications_type_check";--> statement-breakpoint
ALTER TABLE "reporting"."notifications" DROP CONSTRAINT "notifications_entity_type_check";--> statement-breakpoint ALTER TABLE "reporting"."notification_preferences" DROP CONSTRAINT IF EXISTS "notification_preferences_organization_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "reporting"."notification_preferences" ADD CONSTRAINT "notification_preferences_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "system"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint ALTER TABLE "reporting"."notification_preferences" DROP CONSTRAINT IF EXISTS "notification_preferences_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "reporting"."notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "system"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint ALTER TABLE "reporting"."push_devices" DROP CONSTRAINT IF EXISTS "push_devices_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "reporting"."push_devices" ADD CONSTRAINT "push_devices_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "system"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notification_preferences_org_user_event_uidx" ON "reporting"."notification_preferences" USING btree ("organization_id","user_id","event_type");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "push_devices_token_uidx" ON "reporting"."push_devices" USING btree ("fcm_token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_devices_user_idx" ON "reporting"."push_devices" USING btree ("user_id");--> statement-breakpoint ALTER TABLE "reporting"."notifications" DROP CONSTRAINT IF EXISTS "notifications_type_check";--> statement-breakpoint
ALTER TABLE "reporting"."notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("reporting"."notifications"."type" IN ('daily_manufacturing_report', 'manufacturing_order_created'));--> statement-breakpoint ALTER TABLE "reporting"."notifications" DROP CONSTRAINT IF EXISTS "notifications_entity_type_check";--> statement-breakpoint
ALTER TABLE "reporting"."notifications" ADD CONSTRAINT "notifications_entity_type_check" CHECK ("reporting"."notifications"."entity_type" IN ('report_run', 'manufacturing_order'));--> statement-breakpoint DROP POLICY IF EXISTS "notification_preferences_org_isolation" ON "reporting"."notification_preferences";--> statement-breakpoint
CREATE POLICY "notification_preferences_org_isolation" ON "reporting"."notification_preferences" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint DROP POLICY IF EXISTS "push_devices_select_own" ON "reporting"."push_devices";--> statement-breakpoint
CREATE POLICY "push_devices_select_own" ON "reporting"."push_devices" AS PERMISSIVE FOR SELECT TO public USING (user_id = current_setting('app.current_user_id', true) OR fcm_token = current_setting('app.current_fcm_token', true));--> statement-breakpoint DROP POLICY IF EXISTS "push_devices_insert_own" ON "reporting"."push_devices";--> statement-breakpoint
CREATE POLICY "push_devices_insert_own" ON "reporting"."push_devices" AS PERMISSIVE FOR INSERT TO public WITH CHECK (user_id = current_setting('app.current_user_id', true));--> statement-breakpoint DROP POLICY IF EXISTS "push_devices_reassign_to_current_user" ON "reporting"."push_devices";--> statement-breakpoint
CREATE POLICY "push_devices_reassign_to_current_user" ON "reporting"."push_devices" AS PERMISSIVE FOR UPDATE TO public USING (fcm_token = current_setting('app.current_fcm_token', true)) WITH CHECK (user_id = current_setting('app.current_user_id', true));--> statement-breakpoint DROP POLICY IF EXISTS "push_devices_delete_own" ON "reporting"."push_devices";--> statement-breakpoint
CREATE POLICY "push_devices_delete_own" ON "reporting"."push_devices" AS PERMISSIVE FOR DELETE TO public USING (user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
ALTER TABLE "reporting"."notification_preferences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reporting"."push_devices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "reporting"."notification_preferences" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "reporting"."push_devices" TO app_user;
