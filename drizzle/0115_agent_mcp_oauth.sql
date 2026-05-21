CREATE TABLE IF NOT EXISTS "integrations"."agent_mcp_oauth_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"client_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_hash" text NOT NULL,
	"code_challenge" text NOT NULL,
	"code_challenge_method" varchar(20) NOT NULL,
	"scopes" jsonb DEFAULT '["production_planning:read"]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "integrations"."agent_mcp_oauth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"client_id" text NOT NULL,
	"access_token_hash" text NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"scopes" jsonb DEFAULT '["production_planning:read"]'::jsonb NOT NULL,
	"access_token_expires_at" timestamp with time zone NOT NULL,
	"refresh_token_expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_mcp_oauth_codes_hash_uidx" ON "integrations"."agent_mcp_oauth_codes" USING btree ("code_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_mcp_oauth_codes_org_created_idx" ON "integrations"."agent_mcp_oauth_codes" USING btree ("organization_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_mcp_oauth_codes_expiry_idx" ON "integrations"."agent_mcp_oauth_codes" USING btree ("expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_mcp_oauth_tokens_access_hash_uidx" ON "integrations"."agent_mcp_oauth_tokens" USING btree ("access_token_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_mcp_oauth_tokens_refresh_hash_uidx" ON "integrations"."agent_mcp_oauth_tokens" USING btree ("refresh_token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_mcp_oauth_tokens_org_created_idx" ON "integrations"."agent_mcp_oauth_tokens" USING btree ("organization_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_mcp_oauth_tokens_active_idx" ON "integrations"."agent_mcp_oauth_tokens" USING btree ("organization_id","revoked_at") WHERE revoked_at IS NULL;
--> statement-breakpoint
ALTER TABLE "integrations"."agent_mcp_oauth_codes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "integrations"."agent_mcp_oauth_codes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "integrations"."agent_mcp_oauth_tokens" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "integrations"."agent_mcp_oauth_tokens" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "agent_mcp_oauth_codes_org_isolation" ON "integrations"."agent_mcp_oauth_codes";
--> statement-breakpoint
CREATE POLICY "agent_mcp_oauth_codes_org_isolation" ON "integrations"."agent_mcp_oauth_codes" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
DROP POLICY IF EXISTS "agent_mcp_oauth_tokens_org_isolation" ON "integrations"."agent_mcp_oauth_tokens";
--> statement-breakpoint
CREATE POLICY "agent_mcp_oauth_tokens_org_isolation" ON "integrations"."agent_mcp_oauth_tokens" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
GRANT USAGE ON SCHEMA "integrations" TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "integrations"."agent_mcp_oauth_codes" TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "integrations"."agent_mcp_oauth_tokens" TO app_user;
