UPDATE "inventory"."unit_definitions" AS unit
SET
  "size" = mapped.next_size,
  "uom" = mapped.next_uom,
  "updated_at" = now()
FROM (
  VALUES
    ('Bag', 1::numeric, 'bag', 1::numeric, 'ea'),
    ('Tote', 1::numeric, 'tote', 1::numeric, 'ea'),
    ('Label', 1::numeric, 'lbl', 1::numeric, 'ea'),
    ('Sheet', 1::numeric, 'sheet', 1::numeric, 'ea'),
    ('Pack', 1::numeric, 'pack', 1::numeric, 'ea'),
    ('Pallet', 1::numeric, 'pallet', 1::numeric, 'ea'),
    ('Roll', 1::numeric, 'roll', 1::numeric, 'ea'),
    ('Pallet of 50 40 Pound Bags', 50::numeric, 'bag', 2000::numeric, 'lb'),
    ('Pallet of 40 50 Pound Bags', 40::numeric, 'bag', 2000::numeric, 'lb'),
    ('225 Liter Bale', 225::numeric, 'L', 225::numeric, 'l'),
    ('3100 Liter Bale', 3100::numeric, 'L', 3100::numeric, 'l'),
    ('6200 Liter Bale', 6200::numeric, 'L', 6200::numeric, 'l'),
    ('Cup', 1::numeric, 'cup', 1::numeric, 'c'),
    ('Tablespoon', 1::numeric, 'Tbs', 1::numeric, 'tbsp')
) AS mapped(name, current_size, current_uom, next_size, next_uom)
WHERE unit."deleted_at" IS NULL
  AND unit."organization_id" = (
    SELECT org."id"
    FROM "system"."organization" AS org
    WHERE org."slug" = 'paonia-soil-company'
  )
  AND unit."name" = mapped.name
  AND unit."size" = mapped.current_size
  AND unit."uom" = mapped.current_uom;
