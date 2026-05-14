CREATE TABLE IF NOT EXISTS "system"."user_view_preferences" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"view_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint ALTER TABLE "system"."user_view_preferences" DROP CONSTRAINT IF EXISTS "user_view_preferences_organization_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "system"."user_view_preferences" ADD CONSTRAINT "user_view_preferences_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "system"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint ALTER TABLE "system"."user_view_preferences" DROP CONSTRAINT IF EXISTS "user_view_preferences_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "system"."user_view_preferences" ADD CONSTRAINT "user_view_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "system"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_view_preferences_user_org_view_uidx" ON "system"."user_view_preferences" USING btree ("user_id","organization_id","view_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_view_preferences_organization_id_idx" ON "system"."user_view_preferences" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_view_preferences_user_id_idx" ON "system"."user_view_preferences" USING btree ("user_id");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "system"."user_view_preferences" TO app_user;
