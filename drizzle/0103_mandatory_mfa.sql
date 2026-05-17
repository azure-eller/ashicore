ALTER TABLE "system"."user"
  ADD COLUMN IF NOT EXISTS "two_factor_enabled" boolean DEFAULT false;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system"."two_factor" (
  "id" text PRIMARY KEY NOT NULL,
  "secret" text NOT NULL,
  "backup_codes" text NOT NULL,
  "user_id" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "two_factor_secret_idx"
  ON "system"."two_factor" USING btree ("secret");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "two_factor_userId_idx"
  ON "system"."two_factor" USING btree ("user_id");
--> statement-breakpoint
ALTER TABLE "system"."two_factor"
  DROP CONSTRAINT IF EXISTS "two_factor_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "system"."two_factor"
  ADD CONSTRAINT "two_factor_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "system"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "system" TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "system"."two_factor" TO app_user;
