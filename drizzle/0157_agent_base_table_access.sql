-- Agent reads base tables directly instead of curated agent_query.* views.
--
-- The read-only erp_agent_ro role gets SELECT on the four business schemas plus
-- settings. Org isolation against the agent's arbitrary SQL is DERIVED from each
-- table's existing org-isolation policy: a RESTRICTIVE twin scoped to the
-- unforgeable agent_query.current_org() (a superuser-owned temp table pinned once
-- per request) instead of the settable app.current_org_id GUC. Because it is
-- AND-ed with the existing permissive policy, a forged GUC inside the SQL cannot
-- widen the org — verified against every granted table in the isolation gauntlet.
--
-- This removes the per-table view-maintenance surface: new columns appear
-- automatically, and a new org-scoped table inherits an agent policy by re-running
-- this derivation (its org-isolation policy is already required by repo rules).
-- Only the computed availability view (agent_query.items_stock) is kept.

-- app_user must NOT be a member of erp_agent_ro. The restrictive policies below
-- apply to the named role AND its members, so a leftover membership (from the
-- old SET LOCAL ROLE design) would subject every app_user write to the agent's
-- current_org() check and break it. The agent uses its own login connection now.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'erp_agent_ro') THEN
    CREATE ROLE erp_agent_ro NOLOGIN;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS "agent_query";

CREATE OR REPLACE FUNCTION "agent_query".pin_org(p_org text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _agent_org(org text) ON COMMIT DROP;
  IF EXISTS (SELECT 1 FROM pg_temp._agent_org) THEN
    RAISE EXCEPTION 'agent org already pinned for this transaction';
  END IF;
  INSERT INTO pg_temp._agent_org VALUES (p_org);
  PERFORM set_config('app.current_org_id', p_org, true);
END $$;

CREATE OR REPLACE FUNCTION "agent_query".current_org() RETURNS text
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v text;
BEGIN
  IF to_regclass('pg_temp._agent_org') IS NULL THEN RETURN NULL; END IF;
  EXECUTE 'SELECT org FROM pg_temp._agent_org LIMIT 1' INTO v;
  RETURN v;
END $$;

REVOKE erp_agent_ro FROM app_user;

GRANT USAGE ON SCHEMA "sales", "inventory", "purchasing", "manufacturing", "settings" TO erp_agent_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA "sales", "inventory", "purchasing", "manufacturing", "settings" TO erp_agent_ro;

DO $$
DECLARE r record; adapted text;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch, c.relname AS tbl,
           pg_get_expr(p.polqual, p.polrelid) AS qual
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('sales', 'inventory', 'purchasing', 'manufacturing', 'settings')
      AND p.polpermissive
      AND pg_get_expr(p.polqual, p.polrelid) LIKE '%current_setting(''app.current_org_id''%'
  LOOP
    adapted := replace(
      r.qual,
      'current_setting(''app.current_org_id''::text, true)',
      'agent_query.current_org()'
    );
    EXECUTE format('DROP POLICY IF EXISTS agent_org_isolation ON %I.%I', r.sch, r.tbl);
    EXECUTE format(
      'CREATE POLICY agent_org_isolation ON %I.%I AS RESTRICTIVE TO erp_agent_ro USING (%s)',
      r.sch, r.tbl, adapted
    );
  END LOOP;
END $$;

-- The thin projection views are superseded by direct base-table access. Keep
-- agent_query.items_stock (kernel availability math) and the org helpers.
DROP VIEW IF EXISTS
  "agent_query"."sales_orders",
  "agent_query"."sales_order_lines",
  "agent_query"."customers",
  "agent_query"."purchase_orders",
  "agent_query"."purchase_order_lines",
  "agent_query"."manufacturing_orders",
  "agent_query"."suppliers",
  "agent_query"."tax_rates";

CREATE OR REPLACE VIEW "agent_query"."items_stock" AS
SELECT i.id, i.name, i.sku, i.item_type, i.category, i.sellable, i.safety_stock,
  u.name AS unit_name,
  COALESCE(b.on_hand_qty, 0) AS on_hand_qty,
  COALESCE(b.demand_qty, 0) AS demand_qty,
  GREATEST(0,
    COALESCE((SELECT SUM(lb.quantity) FROM "inventory"."inventory_lot_balances" lb
      WHERE lb.organization_id = i.organization_id AND lb.item_id = i.id
        AND lb.location_id = default_loc.id AND lb.disposition = 'available' AND lb.quantity > 0), 0)
    - COALESCE((SELECT ABS(SUM(lb.quantity)) FROM "inventory"."inventory_lot_balances" lb
      WHERE lb.organization_id = i.organization_id AND lb.item_id = i.id
        AND lb.location_id = default_loc.id AND lb.disposition = 'available' AND lb.quantity < 0), 0)
  ) AS available_qty,
  COALESCE(b.expected_qty, 0) AS expected_qty,
  i.created_at
FROM "inventory"."items" i
LEFT JOIN LATERAL (
  SELECT loc.id FROM "inventory"."locations" loc
  WHERE loc.organization_id = i.organization_id AND loc.is_default = true AND loc.deleted_at IS NULL
  LIMIT 1
) default_loc ON true
LEFT JOIN "inventory"."unit_definitions" u ON u.id = i.unit_definition_id
LEFT JOIN "inventory"."inventory_item_balances" b
  ON b.item_id = i.id AND b.organization_id = i.organization_id AND b.location_id = default_loc.id
WHERE i.deleted_at IS NULL AND i.organization_id = "agent_query".current_org();

REVOKE ALL ON FUNCTION "agent_query".pin_org(text), "agent_query".current_org() FROM PUBLIC;
GRANT USAGE ON SCHEMA "agent_query" TO erp_agent_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA "agent_query" TO erp_agent_ro;
GRANT EXECUTE ON FUNCTION "agent_query".pin_org(text), "agent_query".current_org() TO erp_agent_ro;
