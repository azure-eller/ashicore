ALTER TABLE "accounting"."document_syncs"
  ADD COLUMN IF NOT EXISTS "push_payload_snapshot" jsonb,
  ADD COLUMN IF NOT EXISTS "provider_document_type" varchar(50),
  ADD COLUMN IF NOT EXISTS "idempotency_key" text;
