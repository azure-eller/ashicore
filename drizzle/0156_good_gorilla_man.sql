INSERT INTO "sales"."customer_activities" (
  "organization_id", "customer_id", "customer_project_id", "type", "occurred_at",
  "title", "body", "created_by_user_id", "created_by_name", "deleted_at",
  "created_at", "updated_at"
)
SELECT
  n."organization_id", n."customer_id", n."project_id", 'note', n."created_at",
  NULL, n."body", n."created_by_user_id", n."created_by_name", n."deleted_at",
  n."created_at", n."updated_at"
FROM "sales"."customer_project_notes" n;--> statement-breakpoint
DROP POLICY "sales_customer_project_files_org_isolation" ON "sales"."customer_project_files" CASCADE;--> statement-breakpoint
DROP TABLE "sales"."customer_project_files" CASCADE;--> statement-breakpoint
DROP POLICY "sales_customer_project_notes_org_isolation" ON "sales"."customer_project_notes" CASCADE;--> statement-breakpoint
DROP TABLE "sales"."customer_project_notes" CASCADE;