CREATE TABLE IF NOT EXISTS "system"."user_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"readability" text DEFAULT 'default' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint ALTER TABLE "system"."user_preferences" DROP CONSTRAINT IF EXISTS "user_preferences_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "system"."user_preferences" ADD CONSTRAINT "user_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "system"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "system"."user_preferences" TO app_user;
