CREATE SCHEMA IF NOT EXISTS "integrations";--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "integrations"."connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"provider" varchar(50) NOT NULL,
	"tenant_id" text NOT NULL,
	"tenant_name" text NOT NULL,
	"authorized_tenants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"access_token_ciphertext" text NOT NULL,
	"refresh_token_ciphertext" text NOT NULL,
	"token_encryption_key_id" varchar(100) NOT NULL,
	"token_expires_at" timestamp with time zone NOT NULL,
	"default_account_code" varchar(20),
	"default_tax_type" varchar(50),
	"invoice_status_preference" varchar(20) DEFAULT 'DRAFT' NOT NULL,
	"auto_push_sales_invoices" boolean DEFAULT false NOT NULL,
	"auto_push_purchase_orders" boolean DEFAULT false NOT NULL,
	"auto_email_sales_invoices" boolean DEFAULT false NOT NULL,
	"auto_email_purchase_orders" boolean DEFAULT false NOT NULL,
	"purchase_order_default_account_code" varchar(20),
	"purchase_order_default_tax_type" varchar(50),
	"purchase_order_status_preference" varchar(20) DEFAULT 'DRAFT' NOT NULL,
	"settings" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "integrations"."external_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"provider" varchar(50) NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"local_record_id" uuid NOT NULL,
	"external_id" text,
	"external_code" varchar(100),
	"external_name" varchar(255),
	"external_description" text,
	"metadata" jsonb,
	"external_updated_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "integrations"."import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"provider" varchar(50) NOT NULL,
	"entity_type" varchar(20) NOT NULL,
	"tenant_id" text NOT NULL,
	"tenant_name" text NOT NULL,
	"status" varchar(20) DEFAULT 'completed' NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"undone_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "integrations"."import_run_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"provider" varchar(50) NOT NULL,
	"run_id" uuid NOT NULL,
	"entity_type" varchar(20) NOT NULL,
	"action" varchar(20) NOT NULL,
	"local_record_id" uuid NOT NULL,
	"external_record_id" text,
	"local_name" text NOT NULL,
	"previous_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "accounting"."classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"provider" varchar(50) NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"local_record_id" uuid NOT NULL,
	"account_code" varchar(20),
	"tax_type" varchar(50),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "integration_connections_org_provider_uidx" ON "integrations"."connections" USING btree ("organization_id","provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_connections_org_provider_idx" ON "integrations"."connections" USING btree ("organization_id","provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_connections_tenant_idx" ON "integrations"."connections" USING btree ("provider","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "external_records_local_uidx" ON "integrations"."external_records" USING btree ("organization_id","provider","entity_type","local_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "external_records_external_id_uidx" ON "integrations"."external_records" USING btree ("organization_id","provider","entity_type","external_id") WHERE external_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "external_records_external_code_uidx" ON "integrations"."external_records" USING btree ("organization_id","provider","entity_type","external_code") WHERE external_code IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_records_org_provider_idx" ON "integrations"."external_records" USING btree ("organization_id","provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_records_local_idx" ON "integrations"."external_records" USING btree ("organization_id","provider","entity_type","local_record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_import_runs_org_provider_entity_idx" ON "integrations"."import_runs" USING btree ("organization_id","provider","entity_type","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_import_run_rows_run_idx" ON "integrations"."import_run_rows" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_import_run_rows_local_record_idx" ON "integrations"."import_run_rows" USING btree ("provider","entity_type","local_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accounting_classifications_local_uidx" ON "accounting"."classifications" USING btree ("organization_id","provider","entity_type","local_record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounting_classifications_org_provider_idx" ON "accounting"."classifications" USING btree ("organization_id","provider");--> statement-breakpoint
ALTER TABLE "integrations"."connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integrations"."connections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integrations"."external_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integrations"."external_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integrations"."import_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integrations"."import_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integrations"."import_run_rows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integrations"."import_run_rows" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounting"."classifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounting"."classifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "integration_connections_org_isolation" ON "integrations"."connections";--> statement-breakpoint
CREATE POLICY "integration_connections_org_isolation" ON "integrations"."connections" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "external_records_org_isolation" ON "integrations"."external_records";--> statement-breakpoint
CREATE POLICY "external_records_org_isolation" ON "integrations"."external_records" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "integration_import_runs_org_isolation" ON "integrations"."import_runs";--> statement-breakpoint
CREATE POLICY "integration_import_runs_org_isolation" ON "integrations"."import_runs" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "integration_import_run_rows_org_isolation" ON "integrations"."import_run_rows";--> statement-breakpoint
CREATE POLICY "integration_import_run_rows_org_isolation" ON "integrations"."import_run_rows" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "accounting_classifications_org_isolation" ON "accounting"."classifications";--> statement-breakpoint
CREATE POLICY "accounting_classifications_org_isolation" ON "accounting"."classifications" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
ALTER TABLE "integrations"."import_run_rows" DROP CONSTRAINT IF EXISTS "import_run_rows_run_id_import_runs_id_fk";--> statement-breakpoint
ALTER TABLE "integrations"."import_run_rows" ADD CONSTRAINT "import_run_rows_run_id_import_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "integrations"."import_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" ADD COLUMN IF NOT EXISTS "accounting_purchase_account_code" varchar(20);--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_lines" ADD COLUMN IF NOT EXISTS "accounting_purchase_account_code" varchar(20);--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_additional_costs" ADD COLUMN IF NOT EXISTS "accounting_purchase_account_code" varchar(20);--> statement-breakpoint
DO $$ BEGIN
	IF to_regclass('xero.xero_connections') IS NOT NULL THEN
		INSERT INTO "integrations"."connections" (
			"organization_id", "provider", "tenant_id", "tenant_name", "authorized_tenants",
			"access_token_ciphertext", "refresh_token_ciphertext", "token_encryption_key_id",
			"token_expires_at", "default_account_code", "default_tax_type",
			"invoice_status_preference", "auto_push_sales_invoices", "auto_push_purchase_orders",
			"auto_email_sales_invoices", "auto_email_purchase_orders",
			"purchase_order_default_account_code", "purchase_order_default_tax_type",
			"purchase_order_status_preference", "created_at", "updated_at"
		)
		SELECT
			organization_id, 'xero', tenant_id, tenant_name, authorized_tenants,
			access_token_ciphertext, refresh_token_ciphertext, token_encryption_key_id,
			token_expires_at, default_account_code, default_tax_type,
			invoice_status_preference, auto_push_sales_invoices, auto_push_purchase_orders,
			auto_email_sales_invoices, auto_email_purchase_orders,
			purchase_order_default_account_code, purchase_order_default_tax_type,
			purchase_order_status_preference, created_at, updated_at
		FROM "xero"."xero_connections"
		ON CONFLICT ("organization_id", "provider") DO NOTHING;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF to_regclass('xero.xero_import_runs') IS NOT NULL THEN
		INSERT INTO "integrations"."import_runs" (
			"id", "organization_id", "provider", "entity_type", "tenant_id", "tenant_name",
			"status", "created_count", "updated_count", "skipped_count", "error_count",
			"undone_at", "created_at", "updated_at"
		)
		SELECT
			id, organization_id, 'xero', entity_type, tenant_id, tenant_name,
			status, created_count, updated_count, skipped_count, error_count,
			undone_at, created_at, updated_at
		FROM "xero"."xero_import_runs"
		ON CONFLICT ("id") DO NOTHING;
	END IF;
	IF to_regclass('xero.xero_import_run_rows') IS NOT NULL THEN
		INSERT INTO "integrations"."import_run_rows" (
			"id", "organization_id", "provider", "run_id", "entity_type", "action",
			"local_record_id", "external_record_id", "local_name", "previous_data", "created_at"
		)
		SELECT
			id, organization_id, 'xero', run_id, entity_type, action,
			local_record_id, xero_contact_id, local_name, previous_data, created_at
		FROM "xero"."xero_import_run_rows"
		ON CONFLICT ("id") DO NOTHING;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'sales' AND table_name = 'customers' AND column_name = 'xero_contact_id') THEN
		INSERT INTO "integrations"."external_records" ("organization_id", "provider", "entity_type", "local_record_id", "external_id", "last_synced_at")
		SELECT organization_id, 'xero', 'customer', id, xero_contact_id, now()
		FROM "sales"."customers"
		WHERE xero_contact_id IS NOT NULL
		ON CONFLICT ("organization_id", "provider", "entity_type", "local_record_id") DO NOTHING;
	END IF;
	IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'purchasing' AND table_name = 'suppliers' AND column_name = 'xero_contact_id') THEN
		INSERT INTO "integrations"."external_records" ("organization_id", "provider", "entity_type", "local_record_id", "external_id", "external_code", "metadata", "external_updated_at", "last_synced_at")
		SELECT organization_id, 'xero', 'supplier', id, xero_contact_id, xero_contact_number,
			jsonb_build_object(
				'accountNumber', xero_account_number,
				'purchasesDefaultAccountCode', xero_purchases_default_account_code,
				'accountsPayableTaxType', xero_accounts_payable_tax_type
			),
			xero_updated_at, now()
		FROM "purchasing"."suppliers"
		WHERE xero_contact_id IS NOT NULL OR xero_contact_number IS NOT NULL
		ON CONFLICT ("organization_id", "provider", "entity_type", "local_record_id") DO NOTHING;
	END IF;
	IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'inventory' AND table_name = 'items' AND column_name = 'xero_item_code') THEN
		INSERT INTO "integrations"."external_records" ("organization_id", "provider", "entity_type", "local_record_id", "external_id", "external_code", "external_name", "external_description", "external_updated_at", "last_synced_at")
		SELECT organization_id, 'xero', 'item', id, xero_item_id, xero_item_code, xero_item_name, xero_purchase_description, xero_updated_at, now()
		FROM "inventory"."items"
		WHERE xero_item_id IS NOT NULL OR xero_item_code IS NOT NULL
		ON CONFLICT ("organization_id", "provider", "entity_type", "local_record_id") DO NOTHING;
		INSERT INTO "accounting"."classifications" ("organization_id", "provider", "entity_type", "local_record_id", "account_code", "tax_type")
		SELECT organization_id, 'xero', 'item', id, xero_purchase_account_code, xero_purchase_tax_type
		FROM "inventory"."items"
		WHERE xero_purchase_account_code IS NOT NULL OR xero_purchase_tax_type IS NOT NULL
		ON CONFLICT ("organization_id", "provider", "entity_type", "local_record_id") DO NOTHING;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'sales' AND table_name = 'sales_orders' AND column_name = 'xero_invoice_id') THEN
		INSERT INTO "accounting"."document_syncs" ("organization_id", "provider", "document_type", "document_id", "external_document_id", "external_document_number", "push_status", "push_error", "pushed_at", "push_payload_hash", "last_push_attempt_at", "retry_count", "email_status", "email_error", "emailed_at")
		SELECT organization_id, 'xero', 'sales_order', id, xero_invoice_id, xero_invoice_number, xero_push_status, xero_push_error, xero_pushed_at, xero_push_payload_hash, xero_last_push_attempt_at, xero_retry_count, xero_email_status, xero_email_error, xero_emailed_at
		FROM "sales"."sales_orders"
		WHERE xero_invoice_id IS NOT NULL OR xero_push_status IS NOT NULL
		ON CONFLICT ("organization_id", "provider", "document_type", "document_id") DO NOTHING;
	END IF;
	IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'sales' AND table_name = 'sales_shipments' AND column_name = 'xero_invoice_id') THEN
		INSERT INTO "accounting"."document_syncs" ("organization_id", "provider", "document_type", "document_id", "external_document_id", "external_document_number", "push_status", "push_error", "pushed_at", "push_payload_hash", "last_push_attempt_at", "retry_count", "email_status", "email_error", "emailed_at")
		SELECT so.organization_id, 'xero', 'sales_shipment', ss.id, ss.xero_invoice_id, ss.xero_invoice_number, ss.xero_push_status, ss.xero_push_error, ss.xero_pushed_at, ss.xero_push_payload_hash, ss.xero_last_push_attempt_at, ss.xero_retry_count, ss.xero_email_status, ss.xero_email_error, ss.xero_emailed_at
		FROM "sales"."sales_shipments" ss
		INNER JOIN "sales"."sales_orders" so ON so.id = ss.sales_order_id
		WHERE ss.xero_invoice_id IS NOT NULL OR ss.xero_push_status IS NOT NULL
		ON CONFLICT ("organization_id", "provider", "document_type", "document_id") DO NOTHING;
	END IF;
	IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'purchasing' AND table_name = 'purchase_orders' AND column_name = 'xero_purchase_order_id') THEN
		INSERT INTO "accounting"."document_syncs" ("organization_id", "provider", "document_type", "document_id", "external_document_id", "external_document_number", "push_status", "push_error", "pushed_at", "push_payload_hash", "last_push_attempt_at", "retry_count", "email_status", "email_error", "emailed_at")
		SELECT organization_id, 'xero', 'purchase_order', id, xero_purchase_order_id, xero_purchase_order_number, xero_push_status, xero_push_error, xero_pushed_at, xero_push_payload_hash, xero_last_push_attempt_at, xero_retry_count, xero_po_email_status, xero_po_email_error, xero_po_emailed_at
		FROM "purchasing"."purchase_orders"
		WHERE xero_purchase_order_id IS NOT NULL OR xero_push_status IS NOT NULL
		ON CONFLICT ("organization_id", "provider", "document_type", "document_id") DO NOTHING;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'purchasing' AND table_name = 'purchase_orders' AND column_name = 'xero_purchase_account_code') THEN
		UPDATE "purchasing"."purchase_orders" SET "accounting_purchase_account_code" = "xero_purchase_account_code" WHERE "accounting_purchase_account_code" IS NULL;
	END IF;
	IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'purchasing' AND table_name = 'purchase_order_lines' AND column_name = 'xero_purchase_account_code') THEN
		UPDATE "purchasing"."purchase_order_lines" SET "accounting_purchase_account_code" = "xero_purchase_account_code" WHERE "accounting_purchase_account_code" IS NULL;
	END IF;
	IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'purchasing' AND table_name = 'purchase_order_additional_costs' AND column_name = 'xero_purchase_account_code') THEN
		UPDATE "purchasing"."purchase_order_additional_costs" SET "accounting_purchase_account_code" = "xero_purchase_account_code" WHERE "accounting_purchase_account_code" IS NULL;
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "sales"."customers" DROP COLUMN IF EXISTS "xero_contact_id";--> statement-breakpoint
ALTER TABLE "purchasing"."suppliers" DROP COLUMN IF EXISTS "xero_contact_id";--> statement-breakpoint
ALTER TABLE "purchasing"."suppliers" DROP COLUMN IF EXISTS "xero_contact_number";--> statement-breakpoint
ALTER TABLE "purchasing"."suppliers" DROP COLUMN IF EXISTS "xero_account_number";--> statement-breakpoint
ALTER TABLE "purchasing"."suppliers" DROP COLUMN IF EXISTS "xero_purchases_default_account_code";--> statement-breakpoint
ALTER TABLE "purchasing"."suppliers" DROP COLUMN IF EXISTS "xero_accounts_payable_tax_type";--> statement-breakpoint
ALTER TABLE "purchasing"."suppliers" DROP COLUMN IF EXISTS "xero_updated_at";--> statement-breakpoint
ALTER TABLE "inventory"."items" DROP COLUMN IF EXISTS "xero_item_id";--> statement-breakpoint
ALTER TABLE "inventory"."items" DROP COLUMN IF EXISTS "xero_item_code";--> statement-breakpoint
ALTER TABLE "inventory"."items" DROP COLUMN IF EXISTS "xero_item_name";--> statement-breakpoint
ALTER TABLE "inventory"."items" DROP COLUMN IF EXISTS "xero_purchase_description";--> statement-breakpoint
ALTER TABLE "inventory"."items" DROP COLUMN IF EXISTS "xero_purchase_account_code";--> statement-breakpoint
ALTER TABLE "inventory"."items" DROP COLUMN IF EXISTS "xero_purchase_tax_type";--> statement-breakpoint
ALTER TABLE "inventory"."items" DROP COLUMN IF EXISTS "xero_updated_at";--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" DROP COLUMN IF EXISTS "xero_invoice_id";--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" DROP COLUMN IF EXISTS "xero_invoice_number";--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" DROP COLUMN IF EXISTS "xero_push_status";--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" DROP COLUMN IF EXISTS "xero_push_error";--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" DROP COLUMN IF EXISTS "xero_pushed_at";--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" DROP COLUMN IF EXISTS "xero_push_payload_hash";--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" DROP COLUMN IF EXISTS "xero_last_push_attempt_at";--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" DROP COLUMN IF EXISTS "xero_retry_count";--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" DROP COLUMN IF EXISTS "xero_email_status";--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" DROP COLUMN IF EXISTS "xero_email_error";--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" DROP COLUMN IF EXISTS "xero_emailed_at";--> statement-breakpoint
ALTER TABLE "sales"."sales_shipments" DROP COLUMN IF EXISTS "xero_invoice_id";--> statement-breakpoint
ALTER TABLE "sales"."sales_shipments" DROP COLUMN IF EXISTS "xero_invoice_number";--> statement-breakpoint
ALTER TABLE "sales"."sales_shipments" DROP COLUMN IF EXISTS "xero_push_status";--> statement-breakpoint
ALTER TABLE "sales"."sales_shipments" DROP COLUMN IF EXISTS "xero_push_error";--> statement-breakpoint
ALTER TABLE "sales"."sales_shipments" DROP COLUMN IF EXISTS "xero_pushed_at";--> statement-breakpoint
ALTER TABLE "sales"."sales_shipments" DROP COLUMN IF EXISTS "xero_push_payload_hash";--> statement-breakpoint
ALTER TABLE "sales"."sales_shipments" DROP COLUMN IF EXISTS "xero_last_push_attempt_at";--> statement-breakpoint
ALTER TABLE "sales"."sales_shipments" DROP COLUMN IF EXISTS "xero_retry_count";--> statement-breakpoint
ALTER TABLE "sales"."sales_shipments" DROP COLUMN IF EXISTS "xero_email_status";--> statement-breakpoint
ALTER TABLE "sales"."sales_shipments" DROP COLUMN IF EXISTS "xero_email_error";--> statement-breakpoint
ALTER TABLE "sales"."sales_shipments" DROP COLUMN IF EXISTS "xero_emailed_at";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" DROP COLUMN IF EXISTS "xero_purchase_account_code";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" DROP COLUMN IF EXISTS "xero_purchase_order_id";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" DROP COLUMN IF EXISTS "xero_purchase_order_number";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" DROP COLUMN IF EXISTS "xero_push_status";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" DROP COLUMN IF EXISTS "xero_push_error";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" DROP COLUMN IF EXISTS "xero_pushed_at";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" DROP COLUMN IF EXISTS "xero_push_payload_hash";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" DROP COLUMN IF EXISTS "xero_last_push_attempt_at";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" DROP COLUMN IF EXISTS "xero_retry_count";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" DROP COLUMN IF EXISTS "xero_po_email_status";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" DROP COLUMN IF EXISTS "xero_po_email_error";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" DROP COLUMN IF EXISTS "xero_po_emailed_at";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_lines" DROP COLUMN IF EXISTS "xero_purchase_account_code";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_additional_costs" DROP COLUMN IF EXISTS "xero_purchase_account_code";--> statement-breakpoint
DROP SCHEMA IF EXISTS "xero" CASCADE;--> statement-breakpoint
GRANT USAGE ON SCHEMA "integrations" TO app_user;--> statement-breakpoint
GRANT USAGE ON SCHEMA "accounting" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "integrations" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "accounting" TO app_user;
