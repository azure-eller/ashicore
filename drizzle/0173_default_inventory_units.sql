DO $$
DECLARE
  "org_id" text;
BEGIN
  FOR "org_id" IN
    SELECT "id" FROM "system"."organization"
  LOOP
    PERFORM set_config('app.current_org_id', "org_id", true);

    INSERT INTO "inventory"."unit_definitions" (
      "id",
      "organization_id",
      "name",
      "size",
      "uom",
      "created_at",
      "updated_at"
    )
    SELECT
      gen_random_uuid(),
      "org_id",
      "defaults"."name",
      "defaults"."size",
      "defaults"."uom",
      now(),
      now()
    FROM (
      VALUES
        ('Each', 1, 'ea'),
        ('Piece', 1, 'pcs'),
        ('Pound', 1, 'lb'),
        ('Ounce', 1, 'oz'),
        ('Kilogram', 1, 'kg'),
        ('Gram', 1, 'g'),
        ('Gallon', 1, 'gal'),
        ('Liter', 1, 'l')
    ) AS "defaults"("name", "size", "uom")
    WHERE NOT EXISTS (
      SELECT 1
      FROM "inventory"."unit_definitions"
      WHERE "inventory"."unit_definitions"."deleted_at" IS NULL
    );
  END LOOP;
END $$;
