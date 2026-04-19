DO $$
DECLARE
  product RECORD;
  component RECORD;
  revision_id uuid;
  next_revision integer;
  component_index integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'inventory'
      AND table_name = 'bom_components'
  ) THEN
    RETURN;
  END IF;

  FOR product IN
    SELECT DISTINCT i.id, i.organization_id
    FROM inventory.items i
    INNER JOIN inventory.bom_components bc ON bc.item_id = i.id
    WHERE i.item_type = 'product'
      AND i.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM inventory.bom_revisions br
        WHERE br.product_id = i.id
          AND br.is_current = true
      )
  LOOP
    SELECT COALESCE(MAX(br.revision_number), 0) + 1
    INTO next_revision
    FROM inventory.bom_revisions br
    WHERE br.product_id = product.id;

    INSERT INTO inventory.bom_revisions (
      organization_id,
      product_id,
      revision_number,
      is_current,
      note,
      created_by
    ) VALUES (
      product.organization_id,
      product.id,
      next_revision,
      true,
      'Backfilled from legacy BOM table during 0042 drop',
      'migration-0042'
    )
    RETURNING id INTO revision_id;

    component_index := 0;

    FOR component IN
      SELECT
        bc.component_id,
        child.name AS component_name,
        child.sku AS component_sku,
        child.item_type AS component_item_type,
        unit_defs.name AS unit_name,
        bc.quantity
      FROM inventory.bom_components bc
      INNER JOIN inventory.items child ON child.id = bc.component_id
      INNER JOIN inventory.unit_definitions unit_defs ON unit_defs.id = child.unit_definition_id
      WHERE bc.item_id = product.id
      ORDER BY bc.created_at ASC, bc.id ASC
    LOOP
      INSERT INTO inventory.bom_revision_components (
        bom_revision_id,
        component_id,
        component_name,
        component_sku,
        component_item_type,
        unit_name,
        quantity,
        sort_order
      ) VALUES (
        revision_id,
        component.component_id,
        component.component_name,
        component.component_sku,
        component.component_item_type,
        component.unit_name,
        component.quantity,
        component_index
      );

      component_index := component_index + 1;
    END LOOP;
  END LOOP;
END $$;--> statement-breakpoint

DROP POLICY IF EXISTS "bom_components_org_isolation" ON "inventory"."bom_components" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "inventory"."bom_components" CASCADE;
