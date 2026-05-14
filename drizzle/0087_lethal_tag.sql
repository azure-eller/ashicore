DELETE FROM "xero"."xero_connections";--> statement-breakpoint
ALTER TABLE "xero"."xero_connections" DROP COLUMN IF EXISTS "access_token";--> statement-breakpoint
ALTER TABLE "xero"."xero_connections" DROP COLUMN IF EXISTS "refresh_token";--> statement-breakpoint
ALTER TABLE "xero"."xero_connections" ADD COLUMN IF NOT EXISTS "access_token_ciphertext" text NOT NULL;--> statement-breakpoint
ALTER TABLE "xero"."xero_connections" ADD COLUMN IF NOT EXISTS "refresh_token_ciphertext" text NOT NULL;--> statement-breakpoint
ALTER TABLE "xero"."xero_connections" ADD COLUMN IF NOT EXISTS "token_encryption_key_id" varchar(100) NOT NULL;
