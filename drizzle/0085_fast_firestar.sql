CREATE SCHEMA IF NOT EXISTS "attachments";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "accounting";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "attachments"."files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"owner_type" varchar(50) NOT NULL,
	"owner_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"blob_url" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" varchar(255) NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by_user_id" text,
	"uploaded_by_name" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments"."files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "accounting"."attachment_syncs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"provider" varchar(50) NOT NULL,
	"attachment_id" uuid NOT NULL,
	"external_attachment_id" text,
	"sync_status" varchar(20),
	"sync_error" text,
	"synced_at" timestamp with time zone,
	"last_sync_attempt_at" timestamp with time zone,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounting"."attachment_syncs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "accounting"."document_syncs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"provider" varchar(50) NOT NULL,
	"document_type" varchar(50) NOT NULL,
	"document_id" uuid NOT NULL,
	"external_document_id" text,
	"external_document_number" varchar(100),
	"push_status" varchar(20),
	"push_error" text,
	"pushed_at" timestamp with time zone,
	"push_payload_hash" text,
	"last_push_attempt_at" timestamp with time zone,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"email_status" varchar(20),
	"email_error" text,
	"emailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounting"."document_syncs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint ALTER TABLE "accounting"."attachment_syncs" DROP CONSTRAINT IF EXISTS "attachment_syncs_attachment_id_files_id_fk";--> statement-breakpoint
ALTER TABLE "accounting"."attachment_syncs" ADD CONSTRAINT "attachment_syncs_attachment_id_files_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "attachments"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attachment_files_org_owner_idx" ON "attachments"."files" USING btree ("organization_id","owner_type","owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attachment_files_active_idx" ON "attachments"."files" USING btree ("organization_id","owner_type","owner_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "attachment_files_storage_key_uidx" ON "attachments"."files" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounting_attachment_syncs_org_provider_idx" ON "accounting"."attachment_syncs" USING btree ("organization_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accounting_attachment_syncs_attachment_uidx" ON "accounting"."attachment_syncs" USING btree ("organization_id","provider","attachment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounting_document_syncs_org_provider_idx" ON "accounting"."document_syncs" USING btree ("organization_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accounting_document_syncs_document_uidx" ON "accounting"."document_syncs" USING btree ("organization_id","provider","document_type","document_id");--> statement-breakpoint DROP POLICY IF EXISTS "attachment_files_org_isolation" ON "attachments"."files";--> statement-breakpoint
CREATE POLICY "attachment_files_org_isolation" ON "attachments"."files" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint DROP POLICY IF EXISTS "accounting_attachment_syncs_org_isolation" ON "accounting"."attachment_syncs";--> statement-breakpoint
CREATE POLICY "accounting_attachment_syncs_org_isolation" ON "accounting"."attachment_syncs" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint DROP POLICY IF EXISTS "accounting_document_syncs_org_isolation" ON "accounting"."document_syncs";--> statement-breakpoint
CREATE POLICY "accounting_document_syncs_org_isolation" ON "accounting"."document_syncs" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
ALTER TABLE "attachments"."files" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "accounting"."attachment_syncs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "accounting"."document_syncs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "attachments" TO app_user;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "accounting" TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "attachments" TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "accounting" TO app_user;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "attachments" TO app_user;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "accounting" TO app_user;
--> statement-breakpoint
INSERT INTO "accounting"."document_syncs" (
  "organization_id",
  "provider",
  "document_type",
  "document_id",
  "external_document_id",
  "external_document_number",
  "push_status",
  "push_error",
  "pushed_at",
  "push_payload_hash",
  "last_push_attempt_at",
  "retry_count",
  "email_status",
  "email_error",
  "emailed_at",
  "created_at",
  "updated_at"
)
SELECT
  "organization_id",
  'xero',
  'purchase_order',
  "id",
  "xero_purchase_order_id",
  "xero_purchase_order_number",
  "xero_push_status",
  "xero_push_error",
  "xero_pushed_at",
  "xero_push_payload_hash",
  "xero_last_push_attempt_at",
  "xero_retry_count",
  "xero_po_email_status",
  "xero_po_email_error",
  "xero_po_emailed_at",
  now(),
  now()
FROM "purchasing"."purchase_orders"
WHERE
  "xero_purchase_order_id" IS NOT NULL
  OR "xero_push_status" IS NOT NULL
  OR "xero_po_email_status" IS NOT NULL
ON CONFLICT ("organization_id", "provider", "document_type", "document_id")
DO UPDATE SET
  "external_document_id" = COALESCE(EXCLUDED."external_document_id", "accounting"."document_syncs"."external_document_id"),
  "external_document_number" = COALESCE(EXCLUDED."external_document_number", "accounting"."document_syncs"."external_document_number"),
  "push_status" = COALESCE(EXCLUDED."push_status", "accounting"."document_syncs"."push_status"),
  "push_error" = COALESCE(EXCLUDED."push_error", "accounting"."document_syncs"."push_error"),
  "pushed_at" = COALESCE(EXCLUDED."pushed_at", "accounting"."document_syncs"."pushed_at"),
  "push_payload_hash" = COALESCE(EXCLUDED."push_payload_hash", "accounting"."document_syncs"."push_payload_hash"),
  "last_push_attempt_at" = COALESCE(EXCLUDED."last_push_attempt_at", "accounting"."document_syncs"."last_push_attempt_at"),
  "retry_count" = EXCLUDED."retry_count",
  "email_status" = COALESCE(EXCLUDED."email_status", "accounting"."document_syncs"."email_status"),
  "email_error" = COALESCE(EXCLUDED."email_error", "accounting"."document_syncs"."email_error"),
  "emailed_at" = COALESCE(EXCLUDED."emailed_at", "accounting"."document_syncs"."emailed_at"),
  "updated_at" = now();
