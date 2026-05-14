DROP INDEX IF EXISTS "integrations"."external_records_external_id_uidx";--> statement-breakpoint
DROP INDEX IF EXISTS "integrations"."external_records_external_code_uidx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_records_external_id_idx" ON "integrations"."external_records" USING btree ("organization_id","provider","entity_type","external_id") WHERE external_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_records_external_code_idx" ON "integrations"."external_records" USING btree ("organization_id","provider","entity_type","external_code") WHERE external_code IS NOT NULL;
