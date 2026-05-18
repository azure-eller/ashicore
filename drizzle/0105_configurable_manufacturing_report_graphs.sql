ALTER TABLE "reporting"."report_schedules"
  ADD COLUMN IF NOT EXISTS "config" jsonb DEFAULT '{}'::jsonb NOT NULL;
