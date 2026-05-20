CREATE TABLE IF NOT EXISTS "integrations"."agent_api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"name" varchar(120) NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" varchar(80) NOT NULL,
	"scopes" jsonb DEFAULT '["production_planning:read"]'::jsonb NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_api_tokens_hash_uidx" ON "integrations"."agent_api_tokens" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_api_tokens_org_created_idx" ON "integrations"."agent_api_tokens" USING btree ("organization_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_api_tokens_org_active_idx" ON "integrations"."agent_api_tokens" USING btree ("organization_id","revoked_at") WHERE revoked_at IS NULL;
--> statement-breakpoint
ALTER TABLE "integrations"."agent_api_tokens" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "integrations"."agent_api_tokens" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "agent_api_tokens_org_isolation" ON "integrations"."agent_api_tokens";
--> statement-breakpoint
CREATE POLICY "agent_api_tokens_org_isolation" ON "integrations"."agent_api_tokens" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
GRANT USAGE ON SCHEMA "integrations" TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "integrations"."agent_api_tokens" TO app_user;
