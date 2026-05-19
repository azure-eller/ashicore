CREATE TABLE IF NOT EXISTS "inventory"."item_families" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL,
  "item_type" varchar(20) NOT NULL,
  "name" varchar(255) NOT NULL,
  "category" varchar(100),
  "description" text,
  "unit_definition_id" uuid NOT NULL,
  "default_supplier_id" uuid,
  "purchase_unit_definition_id" uuid,
  "purchase_to_stock_factor" numeric(12, 4),
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "item_families_item_type_check" CHECK ("item_type" IN ('product', 'material'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory"."variant_options" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL,
  "family_id" uuid NOT NULL,
  "name" varchar(100) NOT NULL,
  "code" varchar(100) NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "disabled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory"."variant_option_values" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL,
  "option_id" uuid NOT NULL,
  "label" varchar(100) NOT NULL,
  "code" varchar(100) NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "disabled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory"."items"
  ADD COLUMN IF NOT EXISTS "family_id" uuid,
  ADD COLUMN IF NOT EXISTS "option_combination_key" text DEFAULT '' NOT NULL,
  ADD COLUMN IF NOT EXISTS "registered_barcode" varchar(100),
  ADD COLUMN IF NOT EXISTS "internal_barcode" varchar(100),
  ADD COLUMN IF NOT EXISTS "supplier_item_code" varchar(100),
  ADD COLUMN IF NOT EXISTS "default_lead_time_days" integer,
  ADD COLUMN IF NOT EXISTS "minimum_order_quantity" numeric(12, 4);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory"."item_variant_values" (
  "organization_id" text NOT NULL,
  "item_id" uuid NOT NULL,
  "option_id" uuid NOT NULL,
  "option_value_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "item_variant_values_item_id_option_id_pk" PRIMARY KEY("item_id", "option_id")
);
--> statement-breakpoint
DO $$
DECLARE
  operational_ref record;
BEGIN
  SELECT ref_type, item_id
  INTO operational_ref
  FROM (
    SELECT 'sales_order_line' AS ref_type, parent.id AS item_id
    FROM "inventory"."items" parent
    JOIN "sales"."sales_order_lines" line ON line.item_id = parent.id
    WHERE parent.is_master = true AND parent.deleted_at IS NULL
    UNION ALL
    SELECT 'purchase_order_line', parent.id
    FROM "inventory"."items" parent
    JOIN "purchasing"."purchase_order_lines" line ON line.item_id = parent.id
    WHERE parent.is_master = true AND parent.deleted_at IS NULL
    UNION ALL
    SELECT 'manufacturing_order_product', parent.id
    FROM "inventory"."items" parent
    JOIN "manufacturing"."manufacturing_orders" mo ON mo.product_id = parent.id
    WHERE parent.is_master = true AND parent.deleted_at IS NULL
    UNION ALL
    SELECT 'manufacturing_order_ingredient', parent.id
    FROM "inventory"."items" parent
    JOIN "manufacturing"."manufacturing_order_ingredients" ingredient ON ingredient.item_id = parent.id
    WHERE parent.is_master = true AND parent.deleted_at IS NULL
    UNION ALL
    SELECT 'bom_component', parent.id
    FROM "inventory"."items" parent
    JOIN "inventory"."bom_revision_components" component ON component.component_id = parent.id
    WHERE parent.is_master = true AND parent.deleted_at IS NULL
    UNION ALL
    SELECT 'lot', parent.id
    FROM "inventory"."items" parent
    JOIN "inventory"."lots" lot ON lot.item_id = parent.id
    WHERE parent.is_master = true AND parent.deleted_at IS NULL
  ) refs
  LIMIT 1;

  IF operational_ref IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot migrate item master %: unexpected operational reference in %',
      operational_ref.item_id,
      operational_ref.ref_type;
  END IF;
END $$;
--> statement-breakpoint
CREATE TEMP TABLE _item_family_backfill ON COMMIT DROP AS
SELECT
  source.id AS source_item_id,
  (
    substr(md5('item_family:' || source.id::text), 1, 8) || '-' ||
    substr(md5('item_family:' || source.id::text), 9, 4) || '-' ||
    substr(md5('item_family:' || source.id::text), 13, 4) || '-' ||
    substr(md5('item_family:' || source.id::text), 17, 4) || '-' ||
    substr(md5('item_family:' || source.id::text), 21, 12)
  )::uuid AS family_id
FROM "inventory"."items" source
WHERE source.deleted_at IS NULL
  AND source.family_id IS NULL
  AND (source.is_master = true OR source.parent_id IS NULL)
  AND (
    source.unit_definition_id IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM "inventory"."items" child
      WHERE child.parent_id = source.id
        AND child.deleted_at IS NULL
        AND child.unit_definition_id IS NOT NULL
    )
  );
--> statement-breakpoint
DO $$
DECLARE
  conflicting_master record;
BEGIN
  SELECT
    master.id AS master_item_id,
    master.organization_id,
    string_agg(DISTINCT child.unit_definition_id::text, ', ' ORDER BY child.unit_definition_id::text) AS unit_definition_ids
  INTO conflicting_master
  FROM "inventory"."items" master
  JOIN "inventory"."items" child ON child.parent_id = master.id
  WHERE master.deleted_at IS NULL
    AND master.is_master = true
    AND child.deleted_at IS NULL
    AND child.unit_definition_id IS NOT NULL
  GROUP BY master.id, master.organization_id
  HAVING COUNT(DISTINCT child.unit_definition_id) > 1
  LIMIT 1;

  IF conflicting_master.master_item_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot migrate item master % in organization %: active variants have conflicting unit_definition_id values: %',
      conflicting_master.master_item_id,
      conflicting_master.organization_id,
      conflicting_master.unit_definition_ids;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO "inventory"."item_families" (
  "id",
  "organization_id",
  "item_type",
  "name",
  "category",
  "description",
  "unit_definition_id",
  "purchase_unit_definition_id",
  "purchase_to_stock_factor",
  "deleted_at",
  "created_at",
  "updated_at"
)
SELECT
  backfill.family_id,
  source.organization_id,
  source.item_type,
  source.name,
  source.category,
  source.description,
  COALESCE(source.unit_definition_id, child_unit.unit_definition_id),
  CASE WHEN source.item_type = 'material' THEN source.purchase_unit_definition_id ELSE NULL END,
  CASE WHEN source.item_type = 'material' THEN source.purchase_to_stock_factor ELSE NULL END,
  source.deleted_at,
  source.created_at,
  source.updated_at
FROM _item_family_backfill backfill
JOIN "inventory"."items" source ON source.id = backfill.source_item_id
LEFT JOIN LATERAL (
  SELECT child.unit_definition_id
  FROM "inventory"."items" child
  WHERE child.parent_id = source.id
    AND child.deleted_at IS NULL
    AND child.unit_definition_id IS NOT NULL
  ORDER BY child.created_at, child.id
  LIMIT 1
) child_unit ON true
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
UPDATE "inventory"."items" item
SET
  "family_id" = backfill.family_id,
  "option_combination_key" = '',
  "updated_at" = now()
FROM _item_family_backfill backfill
WHERE item.id = backfill.source_item_id
  AND item.deleted_at IS NULL
  AND item.family_id IS NULL
  AND item.is_master = false
  AND item.parent_id IS NULL;
--> statement-breakpoint
UPDATE "inventory"."items" child
SET
  "family_id" = backfill.family_id,
  "updated_at" = now()
FROM _item_family_backfill backfill
WHERE child.parent_id = backfill.source_item_id
  AND child.deleted_at IS NULL
  AND child.family_id IS NULL;
--> statement-breakpoint
CREATE TEMP TABLE _variant_option_backfill ON COMMIT DROP AS
SELECT
  family_backfill.family_id,
  parent.organization_id,
  axis.name,
  ('opt_' || substr(md5(axis.name), 1, 16))::varchar(100) AS code,
  (axis.ordinality - 1)::integer AS sort_order,
  (
    substr(md5('variant_option:' || family_backfill.family_id::text || ':' || axis.name), 1, 8) || '-' ||
    substr(md5('variant_option:' || family_backfill.family_id::text || ':' || axis.name), 9, 4) || '-' ||
    substr(md5('variant_option:' || family_backfill.family_id::text || ':' || axis.name), 13, 4) || '-' ||
    substr(md5('variant_option:' || family_backfill.family_id::text || ':' || axis.name), 17, 4) || '-' ||
    substr(md5('variant_option:' || family_backfill.family_id::text || ':' || axis.name), 21, 12)
  )::uuid AS option_id
FROM _item_family_backfill family_backfill
JOIN "inventory"."items" parent ON parent.id = family_backfill.source_item_id
CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(parent.variant_axes, '[]'::jsonb))
  WITH ORDINALITY AS axis(name, ordinality)
WHERE parent.is_master = true
  AND parent.deleted_at IS NULL;
--> statement-breakpoint
INSERT INTO "inventory"."variant_options" (
  "id",
  "organization_id",
  "family_id",
  "name",
  "code",
  "sort_order"
)
SELECT
  option_id,
  organization_id,
  family_id,
  name,
  code,
  sort_order
FROM _variant_option_backfill
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
CREATE TEMP TABLE _variant_value_backfill ON COMMIT DROP AS
SELECT
  option_backfill.option_id,
  option_backfill.organization_id,
  value_label.label,
  ('val_' || substr(md5(value_label.label), 1, 16))::varchar(100) AS code,
  (row_number() OVER (
    PARTITION BY option_backfill.option_id
    ORDER BY value_label.label
  ) - 1)::integer AS sort_order,
  (
    substr(md5('variant_value:' || option_backfill.option_id::text || ':' || value_label.label), 1, 8) || '-' ||
    substr(md5('variant_value:' || option_backfill.option_id::text || ':' || value_label.label), 9, 4) || '-' ||
    substr(md5('variant_value:' || option_backfill.option_id::text || ':' || value_label.label), 13, 4) || '-' ||
    substr(md5('variant_value:' || option_backfill.option_id::text || ':' || value_label.label), 17, 4) || '-' ||
    substr(md5('variant_value:' || option_backfill.option_id::text || ':' || value_label.label), 21, 12)
  )::uuid AS value_id
FROM _variant_option_backfill option_backfill
JOIN "inventory"."items" child
  ON child.family_id = option_backfill.family_id
 AND child.deleted_at IS NULL
CROSS JOIN LATERAL (
  SELECT child.variant_attrs ->> option_backfill.name AS label
) value_label
WHERE value_label.label IS NOT NULL
GROUP BY
  option_backfill.option_id,
  option_backfill.organization_id,
  value_label.label;
--> statement-breakpoint
INSERT INTO "inventory"."variant_option_values" (
  "id",
  "organization_id",
  "option_id",
  "label",
  "code",
  "sort_order"
)
SELECT
  value_id,
  organization_id,
  option_id,
  label,
  code,
  sort_order
FROM _variant_value_backfill
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "inventory"."item_variant_values" (
  "organization_id",
  "item_id",
  "option_id",
  "option_value_id"
)
SELECT
  child.organization_id,
  child.id,
  option_backfill.option_id,
  value_backfill.value_id
FROM "inventory"."items" child
JOIN _variant_option_backfill option_backfill
  ON option_backfill.family_id = child.family_id
JOIN _variant_value_backfill value_backfill
  ON value_backfill.option_id = option_backfill.option_id
 AND value_backfill.label = child.variant_attrs ->> option_backfill.name
WHERE child.deleted_at IS NULL
ON CONFLICT ("item_id", "option_id") DO NOTHING;
--> statement-breakpoint
UPDATE "inventory"."items" item
SET
  "option_combination_key" = COALESCE(keys.option_combination_key, ''),
  "updated_at" = now()
FROM (
  SELECT
    assignment.item_id,
    string_agg(
      option_row.code || '=' || value_row.code,
      '|'
      ORDER BY option_row.sort_order, option_row.code
    ) AS option_combination_key
  FROM "inventory"."item_variant_values" assignment
  JOIN "inventory"."variant_options" option_row ON option_row.id = assignment.option_id
  JOIN "inventory"."variant_option_values" value_row ON value_row.id = assignment.option_value_id
  GROUP BY assignment.item_id
) keys
WHERE item.id = keys.item_id;
--> statement-breakpoint
UPDATE "inventory"."items" parent
SET
  "deleted_at" = COALESCE(parent.deleted_at, now()),
  "updated_at" = now()
WHERE parent.is_master = true
  AND parent.deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM _item_family_backfill backfill
    WHERE backfill.source_item_id = parent.id
  );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "item_families_org_id_idx" ON "inventory"."item_families" ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "item_families_active_idx" ON "inventory"."item_families" ("organization_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "item_families_default_supplier_id_idx" ON "inventory"."item_families" ("default_supplier_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "variant_options_org_id_idx" ON "inventory"."variant_options" ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "variant_options_family_id_idx" ON "inventory"."variant_options" ("family_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "variant_options_family_code_uidx" ON "inventory"."variant_options" ("family_id", "code");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "variant_options_family_sort_order_uidx" ON "inventory"."variant_options" ("family_id", "sort_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "variant_option_values_org_id_idx" ON "inventory"."variant_option_values" ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "variant_option_values_option_id_idx" ON "inventory"."variant_option_values" ("option_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "variant_option_values_option_code_uidx" ON "inventory"."variant_option_values" ("option_id", "code");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "variant_option_values_option_sort_order_uidx" ON "inventory"."variant_option_values" ("option_id", "sort_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_family_id_idx" ON "inventory"."items" ("family_id") WHERE "family_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_option_combination_key_idx" ON "inventory"."items" ("option_combination_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "items_one_active_default_variant_per_family_uidx"
  ON "inventory"."items" ("organization_id", "family_id")
  WHERE "deleted_at" IS NULL
    AND "is_master" = false
    AND "family_id" IS NOT NULL
    AND "option_combination_key" = '';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "item_variant_values_org_id_idx" ON "inventory"."item_variant_values" ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "item_variant_values_option_value_id_idx" ON "inventory"."item_variant_values" ("option_value_id");
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'item_families_unit_definition_id_unit_definitions_id_fk'
  ) THEN
    ALTER TABLE "inventory"."item_families"
      ADD CONSTRAINT "item_families_unit_definition_id_unit_definitions_id_fk"
      FOREIGN KEY ("unit_definition_id") REFERENCES "inventory"."unit_definitions"("id");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'item_families_purchase_unit_definition_id_unit_definitions_id_fk'
  ) THEN
    ALTER TABLE "inventory"."item_families"
      ADD CONSTRAINT "item_families_purchase_unit_definition_id_unit_definitions_id_fk"
      FOREIGN KEY ("purchase_unit_definition_id") REFERENCES "inventory"."unit_definitions"("id");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'item_families_default_supplier_id_suppliers_id_fk'
  ) THEN
    ALTER TABLE "inventory"."item_families"
      ADD CONSTRAINT "item_families_default_supplier_id_suppliers_id_fk"
      FOREIGN KEY ("default_supplier_id") REFERENCES "purchasing"."suppliers"("id");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'variant_options_family_id_item_families_id_fk'
  ) THEN
    ALTER TABLE "inventory"."variant_options"
      ADD CONSTRAINT "variant_options_family_id_item_families_id_fk"
      FOREIGN KEY ("family_id") REFERENCES "inventory"."item_families"("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'variant_option_values_option_id_variant_options_id_fk'
  ) THEN
    ALTER TABLE "inventory"."variant_option_values"
      ADD CONSTRAINT "variant_option_values_option_id_variant_options_id_fk"
      FOREIGN KEY ("option_id") REFERENCES "inventory"."variant_options"("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'items_family_id_item_families_id_fk'
  ) THEN
    ALTER TABLE "inventory"."items"
      ADD CONSTRAINT "items_family_id_item_families_id_fk"
      FOREIGN KEY ("family_id") REFERENCES "inventory"."item_families"("id") ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'item_variant_values_item_id_items_id_fk'
  ) THEN
    ALTER TABLE "inventory"."item_variant_values"
      ADD CONSTRAINT "item_variant_values_item_id_items_id_fk"
      FOREIGN KEY ("item_id") REFERENCES "inventory"."items"("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'item_variant_values_option_id_variant_options_id_fk'
  ) THEN
    ALTER TABLE "inventory"."item_variant_values"
      ADD CONSTRAINT "item_variant_values_option_id_variant_options_id_fk"
      FOREIGN KEY ("option_id") REFERENCES "inventory"."variant_options"("id") ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'item_variant_values_option_value_id_variant_option_values_id_fk'
  ) THEN
    ALTER TABLE "inventory"."item_variant_values"
      ADD CONSTRAINT "item_variant_values_option_value_id_variant_option_values_id_fk"
      FOREIGN KEY ("option_value_id") REFERENCES "inventory"."variant_option_values"("id") ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'items_default_lead_time_days_nonnegative'
  ) THEN
    ALTER TABLE "inventory"."items"
      ADD CONSTRAINT "items_default_lead_time_days_nonnegative"
      CHECK ("default_lead_time_days" IS NULL OR "default_lead_time_days" >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'items_minimum_order_quantity_positive'
  ) THEN
    ALTER TABLE "inventory"."items"
      ADD CONSTRAINT "items_minimum_order_quantity_positive"
      CHECK ("minimum_order_quantity" IS NULL OR "minimum_order_quantity" > 0);
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "inventory"."validate_item_family_match"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  family_row record;
BEGIN
  IF NEW.family_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT organization_id, item_type
  INTO family_row
  FROM "inventory"."item_families"
  WHERE id = NEW.family_id;

  IF family_row IS NULL THEN
    RAISE EXCEPTION 'Item family % not found', NEW.family_id;
  END IF;

  IF family_row.organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'Item % organization does not match family %', NEW.id, NEW.family_id;
  END IF;

  IF family_row.item_type <> NEW.item_type THEN
    RAISE EXCEPTION 'Item % type does not match family %', NEW.id, NEW.family_id;
  END IF;

  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "items_family_match_tg" ON "inventory"."items";
--> statement-breakpoint
CREATE TRIGGER "items_family_match_tg"
  BEFORE INSERT OR UPDATE OF "family_id", "organization_id", "item_type"
  ON "inventory"."items"
  FOR EACH ROW
  EXECUTE FUNCTION "inventory"."validate_item_family_match"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "inventory"."validate_family_item_type_change"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  child_item record;
BEGIN
  SELECT id, item_type
  INTO child_item
  FROM "inventory"."items"
  WHERE family_id = NEW.id
    AND item_type <> NEW.item_type
  LIMIT 1;

  IF child_item.id IS NOT NULL THEN
    RAISE EXCEPTION 'Family % type % does not match child item % type %',
      NEW.id,
      NEW.item_type,
      child_item.id,
      child_item.item_type;
  END IF;

  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "item_families_item_type_match_tg" ON "inventory"."item_families";
--> statement-breakpoint
CREATE TRIGGER "item_families_item_type_match_tg"
  BEFORE UPDATE OF "item_type"
  ON "inventory"."item_families"
  FOR EACH ROW
  EXECUTE FUNCTION "inventory"."validate_family_item_type_change"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "inventory"."validate_item_variant_value_match"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  item_row record;
  option_row record;
  value_row record;
BEGIN
  SELECT id, organization_id, family_id
  INTO item_row
  FROM "inventory"."items"
  WHERE id = NEW.item_id;

  SELECT id, organization_id, family_id
  INTO option_row
  FROM "inventory"."variant_options"
  WHERE id = NEW.option_id;

  SELECT id, organization_id, option_id
  INTO value_row
  FROM "inventory"."variant_option_values"
  WHERE id = NEW.option_value_id;

  IF item_row.family_id IS NULL THEN
    RAISE EXCEPTION 'Item % has no family for variant assignment', NEW.item_id;
  END IF;

  IF option_row.family_id <> item_row.family_id THEN
    RAISE EXCEPTION 'Variant option % does not belong to item % family', NEW.option_id, NEW.item_id;
  END IF;

  IF value_row.option_id <> NEW.option_id THEN
    RAISE EXCEPTION 'Variant value % does not belong to option %', NEW.option_value_id, NEW.option_id;
  END IF;

  IF NEW.organization_id <> item_row.organization_id
    OR NEW.organization_id <> option_row.organization_id
    OR NEW.organization_id <> value_row.organization_id THEN
    RAISE EXCEPTION 'Variant assignment organization mismatch for item %', NEW.item_id;
  END IF;

  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "item_variant_values_match_tg" ON "inventory"."item_variant_values";
--> statement-breakpoint
CREATE TRIGGER "item_variant_values_match_tg"
  BEFORE INSERT OR UPDATE
  ON "inventory"."item_variant_values"
  FOR EACH ROW
  EXECUTE FUNCTION "inventory"."validate_item_variant_value_match"();
--> statement-breakpoint
ALTER TABLE "inventory"."item_families" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventory"."item_families" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "item_families_org_isolation" ON "inventory"."item_families";
--> statement-breakpoint
CREATE POLICY "item_families_org_isolation" ON "inventory"."item_families"
  AS PERMISSIVE FOR ALL TO public
  USING ("organization_id" = current_setting('app.current_org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.current_org_id', true));
--> statement-breakpoint
ALTER TABLE "inventory"."variant_options" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventory"."variant_options" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "variant_options_org_isolation" ON "inventory"."variant_options";
--> statement-breakpoint
CREATE POLICY "variant_options_org_isolation" ON "inventory"."variant_options"
  AS PERMISSIVE FOR ALL TO public
  USING ("organization_id" = current_setting('app.current_org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.current_org_id', true));
--> statement-breakpoint
ALTER TABLE "inventory"."variant_option_values" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventory"."variant_option_values" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "variant_option_values_org_isolation" ON "inventory"."variant_option_values";
--> statement-breakpoint
CREATE POLICY "variant_option_values_org_isolation" ON "inventory"."variant_option_values"
  AS PERMISSIVE FOR ALL TO public
  USING ("organization_id" = current_setting('app.current_org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.current_org_id', true));
--> statement-breakpoint
ALTER TABLE "inventory"."item_variant_values" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventory"."item_variant_values" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "item_variant_values_org_isolation" ON "inventory"."item_variant_values";
--> statement-breakpoint
CREATE POLICY "item_variant_values_org_isolation" ON "inventory"."item_variant_values"
  AS PERMISSIVE FOR ALL TO public
  USING ("organization_id" = current_setting('app.current_org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.current_org_id', true));
--> statement-breakpoint
GRANT USAGE ON SCHEMA "inventory" TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "inventory"."item_families",
  "inventory"."variant_options",
  "inventory"."variant_option_values",
  "inventory"."item_variant_values"
TO app_user;
