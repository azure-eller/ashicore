-- Agent read-only query surface — secured for untrusted SQL.
--
-- Threat model: the agent writes arbitrary SQL. Enforcement does NOT trust the
-- SQL string. It rests on three database facts (verified against a real
-- erp_agent_ro login in the adversarial gauntlet):
--
-- 1. READ-ONLY + ALLOWLIST. erp_agent_ro has SELECT on the agent_query.* views
--    only — no base tables, no writes, no other schemas. It cannot reach
--    system/auth, integrations (OAuth tokens), accounting, or anything we did
--    not expose as a view.
-- 2. NO ESCALATION. erp_agent_ro is a member of no role, so on its dedicated
--    login connection `SET ROLE app_user` and `set_config('role', …)` are
--    denied at the role layer (session_user, not validation).
-- 3. UNFORGEABLE ORG. The views scope on agent_query.current_org(), read from a
--    superuser-owned TEMP table pinned once per request by pin_org(). The agent
--    cannot change it: `set_config('app.current_org_id', victim)` is irrelevant
--    because the views never read that GUC. Views are owned by a BYPASSRLS role
--    so the explicit org filter is the sole scoping.

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'erp_agent_ro') THEN
    CREATE ROLE erp_agent_ro NOLOGIN;
  END IF;
END $$;

-- Neon grants neon_superuser to roles created via its Console/API/CLI, which
-- would let the agent `SET ROLE neon_superuser` (reachable as `SELECT
-- set_config('role','neon_superuser',true)`) and escalate past every control
-- here. Strip the membership on every deploy. No-op off Neon. Best-effort so a
-- permission quirk warns instead of blocking the migration — operators must
-- still confirm erp_agent_ro is a member of nothing.
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'neon_superuser') THEN
    BEGIN
      EXECUTE 'REVOKE neon_superuser FROM erp_agent_ro';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Could not auto-revoke neon_superuser from erp_agent_ro: %', SQLERRM;
    END;
  END IF;
END $$;

-- Drop any prior (insecure) grant lineage from earlier iterations of this file.
REVOKE ALL ON ALL TABLES IN SCHEMA "sales", "inventory", "purchasing", "manufacturing", "settings" FROM erp_agent_ro;
REVOKE ALL ON SCHEMA "sales", "inventory", "purchasing", "manufacturing", "settings" FROM erp_agent_ro;

DROP SCHEMA IF EXISTS "agent_query" CASCADE;
CREATE SCHEMA "agent_query";

-- Set-once org pin: writes the request's org into an owner-owned temp table the
-- agent cannot read, write, or drop. A second call (e.g. agent SQL trying to
-- re-point) raises. ON COMMIT DROP clears it at the end of each request.
CREATE FUNCTION "agent_query".pin_org(p_org text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _agent_org(org text) ON COMMIT DROP;
  IF EXISTS (SELECT 1 FROM pg_temp._agent_org) THEN
    RAISE EXCEPTION 'agent org already pinned for this transaction';
  END IF;
  INSERT INTO pg_temp._agent_org VALUES (p_org);
  -- Also set the GUC so base-table RLS stays consistent if a view owner ever
  -- lacks BYPASSRLS; the immutable temp table remains the real control.
  PERFORM set_config('app.current_org_id', p_org, true);
END $$;

CREATE FUNCTION "agent_query".current_org() RETURNS text
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v text;
BEGIN
  IF to_regclass('pg_temp._agent_org') IS NULL THEN RETURN NULL; END IF;
  EXECUTE 'SELECT org FROM pg_temp._agent_org LIMIT 1' INTO v;
  RETURN v;
END $$;

CREATE VIEW "agent_query"."sales_orders" AS
SELECT o.id, o.order_number, o.customer_id, o.customer_name, o.status, o.priority_rank,
  o.order_date, o.ship_date, o.requested_date,
  COALESCE(o.ship_date, o.requested_date) AS due_date,
  (o.status = 'open' AND COALESCE(o.ship_date, o.requested_date) < CURRENT_DATE) AS is_late,
  o.shipped_at, o.subtotal_amount, o.tax_amount, o.total_amount, o.notes, o.created_at, o.updated_at
FROM "sales"."sales_orders" o
WHERE o.deleted_at IS NULL AND o.organization_id = "agent_query".current_org();

CREATE VIEW "agent_query"."sales_order_lines" AS
SELECT l.id, l.sales_order_id, l.item_id, l.item_name, l.item_sku, l.unit_name,
  l.quantity, l.shipped_quantity, l.cancelled_quantity, l.unit_price, l.discount_percent
FROM "sales"."sales_order_lines" l
JOIN "sales"."sales_orders" o ON o.id = l.sales_order_id
WHERE o.deleted_at IS NULL AND o.organization_id = "agent_query".current_org();

CREATE VIEW "agent_query"."customers" AS
SELECT c.id, c.name, c.account_state, c.account_priority, c.email, c.phone, c.notes, c.created_at
FROM "sales"."customers" c
WHERE c.deleted_at IS NULL AND c.organization_id = "agent_query".current_org();

-- Canonical stock quantities mirror the inventory kernel's lot-disposition math
-- (lib/inventory/kernel/read.ts): available = positive 'available' lot qty minus
-- negative-lot debt, at the org's default location.
CREATE VIEW "agent_query"."items_stock" AS
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

CREATE VIEW "agent_query"."purchase_orders" AS
SELECT p.id, p.order_number, p.supplier_id, p.supplier_name, p.status, p.expected_date,
  p.total_amount, p.received_at, p.notes, p.created_at
FROM "purchasing"."purchase_orders" p
WHERE p.deleted_at IS NULL AND p.organization_id = "agent_query".current_org();

CREATE VIEW "agent_query"."purchase_order_lines" AS
SELECT l.id, l.purchase_order_id, l.item_id, l.quantity_ordered, l.quantity_received, l.unit_cost
FROM "purchasing"."purchase_order_lines" l
JOIN "purchasing"."purchase_orders" p ON p.id = l.purchase_order_id
WHERE p.deleted_at IS NULL AND p.organization_id = "agent_query".current_org();

CREATE VIEW "agent_query"."manufacturing_orders" AS
SELECT m.id, m.order_number, m.product_id, m.product_name, m.product_sku, m.status, m.is_blocked,
  m.requested_quantity, m.planned_quantity, m.actual_quantity, m.unit_name, m.number_of_batches,
  m.planned_date, m.sales_order_id, m.sales_order_number, m.started_at, m.completed_at, m.created_at
FROM "manufacturing"."manufacturing_orders" m
WHERE m.deleted_at IS NULL AND m.organization_id = "agent_query".current_org();

CREATE VIEW "agent_query"."suppliers" AS
SELECT s.id, s.name, s.code, s.contact_name, s.email, s.phone, s.payment_terms, s.notes, s.created_at
FROM "purchasing"."suppliers" s
WHERE s.deleted_at IS NULL AND s.organization_id = "agent_query".current_org();

CREATE VIEW "agent_query"."tax_rates" AS
SELECT t.id, t.name, t.rate_percent, t.created_at
FROM "settings"."tax_rates" t
WHERE t.deleted_at IS NULL AND t.organization_id = "agent_query".current_org();

-- The agent role sees ONLY this schema: usage + SELECT on views + EXECUTE on the
-- pin/current_org helpers. No base tables, no writes.
REVOKE ALL ON FUNCTION "agent_query".pin_org(text), "agent_query".current_org() FROM PUBLIC;
GRANT USAGE ON SCHEMA "agent_query" TO erp_agent_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA "agent_query" TO erp_agent_ro;
GRANT EXECUTE ON FUNCTION "agent_query".pin_org(text), "agent_query".current_org() TO erp_agent_ro;
