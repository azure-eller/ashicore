INSERT INTO "sales"."customer_activities" (
  "organization_id", "customer_id", "type", "occurred_at", "body",
  "created_by_user_id", "created_by_name", "deleted_at", "created_at", "updated_at"
)
SELECT
  c."organization_id", c."id", 'note', c."updated_at", c."notes",
  'migration', 'Migrated', c."deleted_at", c."updated_at", c."updated_at"
FROM "sales"."customers" c
WHERE c."notes" IS NOT NULL AND btrim(c."notes") <> '';--> statement-breakpoint
WITH src AS (
  SELECT cc.*, gen_random_uuid() AS aid
  FROM "sales"."customer_contacts" cc
  WHERE cc."notes" IS NOT NULL AND btrim(cc."notes") <> ''
), ins AS (
  INSERT INTO "sales"."customer_activities" (
    "id", "organization_id", "customer_id", "type", "occurred_at", "body",
    "created_by_user_id", "created_by_name", "deleted_at", "created_at", "updated_at"
  )
  SELECT
    src.aid, src."organization_id", src."customer_id", 'note', src."updated_at",
    src."notes", 'migration', 'Migrated', src."deleted_at", src."updated_at", src."updated_at"
  FROM src
)
INSERT INTO "sales"."customer_activity_attendees" (
  "organization_id", "customer_id", "activity_id", "contact_id", "contact_name"
)
SELECT src."organization_id", src."customer_id", src.aid, src."id", src."name"
FROM src;--> statement-breakpoint
ALTER TABLE "sales"."customer_contacts" DROP COLUMN IF EXISTS "notes";--> statement-breakpoint
ALTER TABLE "sales"."customers" DROP COLUMN IF EXISTS "notes";