CREATE TABLE IF NOT EXISTS "system"."xero_signup_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"xero_user_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"tenant_name" text NOT NULL,
	"authorized_tenants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"access_token_ciphertext" text NOT NULL,
	"refresh_token_ciphertext" text NOT NULL,
	"token_encryption_key_id" varchar(100) NOT NULL,
	"token_expires_at" timestamp with time zone NOT NULL,
	"claim_token_hash" text NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"claimed_user_id" text,
	"claimed_organization_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "xero_signup_intents_claim_token_hash_uidx" ON "system"."xero_signup_intents" USING btree ("claim_token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "xero_signup_intents_email_status_idx" ON "system"."xero_signup_intents" USING btree ("email","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "xero_signup_intents_tenant_status_idx" ON "system"."xero_signup_intents" USING btree ("tenant_id","status");--> statement-breakpoint
DROP INDEX IF EXISTS "integrations"."integration_connections_tenant_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "integration_connections_provider_tenant_uidx" ON "integrations"."connections" USING btree ("provider","tenant_id");--> statement-breakpoint
GRANT USAGE ON SCHEMA "system" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "system"."xero_signup_intents" TO app_user;
