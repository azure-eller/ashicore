CREATE TABLE IF NOT EXISTS "integrations"."audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" varchar(20) NOT NULL,
	"actor_user_id" text,
	"process_name" varchar(100),
	"event_type" varchar(100) NOT NULL,
	"outcome" varchar(20) NOT NULL,
	"source" varchar(200) NOT NULL,
	"provider" varchar(50) NOT NULL,
	"tenant_id" text,
	"tenant_name" text,
	"local_entity_type" varchar(100),
	"local_entity_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_audit_events_actor_check" CHECK (
		(actor_type = 'user' AND actor_user_id IS NOT NULL AND process_name IS NULL)
		OR (actor_type = 'process' AND process_name IS NOT NULL AND actor_user_id IS NULL)
	),
	CONSTRAINT "integration_audit_events_outcome_check" CHECK (outcome IN ('success', 'failure'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_audit_events_org_occurred_idx" ON "integrations"."audit_events" USING btree ("organization_id","occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_audit_events_org_provider_idx" ON "integrations"."audit_events" USING btree ("organization_id","provider","event_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_audit_events_org_entity_idx" ON "integrations"."audit_events" USING btree ("organization_id","local_entity_type","local_entity_id") WHERE local_entity_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "integrations"."audit_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "integrations"."audit_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "integration_audit_events_org_isolation" ON "integrations"."audit_events";
--> statement-breakpoint
CREATE POLICY "integration_audit_events_org_isolation" ON "integrations"."audit_events" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "integrations"."prevent_audit_events_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'integrations.audit_events is append-only';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "prevent_audit_events_mutation" ON "integrations"."audit_events";
--> statement-breakpoint
CREATE TRIGGER "prevent_audit_events_mutation"
BEFORE UPDATE OR DELETE ON "integrations"."audit_events"
FOR EACH ROW EXECUTE FUNCTION "integrations"."prevent_audit_events_mutation"();
--> statement-breakpoint
GRANT USAGE ON SCHEMA "integrations" TO app_user;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE "integrations"."audit_events" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "integrations"."audit_events" TO app_user;
