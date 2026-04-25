-- Rename readability values: default -> small, large -> medium, x-large -> large
UPDATE "system"."user_preferences"
SET "readability" = CASE "readability"
  WHEN 'default' THEN 'small'
  WHEN 'large' THEN 'medium'
  WHEN 'x-large' THEN 'large'
  ELSE "readability"
END
WHERE "readability" IN ('default', 'large', 'x-large');

ALTER TABLE "system"."user_preferences" ALTER COLUMN "readability" SET DEFAULT 'small';
