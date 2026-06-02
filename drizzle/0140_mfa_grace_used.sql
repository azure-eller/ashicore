ALTER TABLE "system"."user" ADD COLUMN IF NOT EXISTS "mfa_grace_used" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "system"."user" SET "mfa_grace_used" = true WHERE "mfa_grace_used" = false;
