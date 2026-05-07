ALTER TABLE "inventory"."items"
  ADD COLUMN IF NOT EXISTS "allow_partial_manufacturing_output" boolean DEFAULT false NOT NULL;

ALTER TABLE "manufacturing"."manufacturing_orders"
  ADD COLUMN IF NOT EXISTS "allow_partial_manufacturing_output" boolean DEFAULT false NOT NULL;

CREATE TABLE IF NOT EXISTS "manufacturing"."manufacturing_order_outputs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "manufacturing_order_id" uuid NOT NULL,
  "manufacturing_order_batch_id" uuid,
  "lot_id" uuid NOT NULL,
  "output_number" integer NOT NULL,
  "quantity" numeric(12, 4) NOT NULL,
  "disposition" varchar(24) DEFAULT 'available' NOT NULL,
  "unit_cost" numeric(18, 6) NOT NULL,
  "material_cost_total" numeric(18, 6) NOT NULL,
  "notes" text,
  "created_by" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "manufacturing_order_outputs_manufacturing_order_id_manufacturing_orders_id_fk"
    FOREIGN KEY ("manufacturing_order_id") REFERENCES "manufacturing"."manufacturing_orders"("id") ON DELETE cascade,
  CONSTRAINT "manufacturing_order_outputs_manufacturing_order_batch_id_manufacturing_order_batches_id_fk"
    FOREIGN KEY ("manufacturing_order_batch_id") REFERENCES "manufacturing"."manufacturing_order_batches"("id") ON DELETE cascade,
  CONSTRAINT "manufacturing_order_outputs_lot_id_lots_id_fk"
    FOREIGN KEY ("lot_id") REFERENCES "inventory"."lots"("id"),
  CONSTRAINT "manufacturing_order_outputs_disposition_check"
    CHECK ("disposition" IN ('available', 'blocked'))
);

CREATE TABLE IF NOT EXISTS "manufacturing"."manufacturing_order_output_consumptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "manufacturing_order_output_id" uuid NOT NULL,
  "manufacturing_order_ingredient_id" uuid NOT NULL,
  "lot_id" uuid NOT NULL,
  "quantity_used" numeric(12, 4) NOT NULL,
  "cost_per_unit" numeric(18, 6) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "manufacturing_order_output_consumptions_output_id_outputs_id_fk"
    FOREIGN KEY ("manufacturing_order_output_id") REFERENCES "manufacturing"."manufacturing_order_outputs"("id") ON DELETE cascade,
  CONSTRAINT "manufacturing_order_output_consumptions_ingredient_id_ingredients_id_fk"
    FOREIGN KEY ("manufacturing_order_ingredient_id") REFERENCES "manufacturing"."manufacturing_order_ingredients"("id") ON DELETE cascade,
  CONSTRAINT "manufacturing_order_output_consumptions_lot_id_lots_id_fk"
    FOREIGN KEY ("lot_id") REFERENCES "inventory"."lots"("id")
);

CREATE INDEX IF NOT EXISTS "manufacturing_order_outputs_order_id_idx"
  ON "manufacturing"."manufacturing_order_outputs" ("manufacturing_order_id");
CREATE INDEX IF NOT EXISTS "manufacturing_order_outputs_batch_id_idx"
  ON "manufacturing"."manufacturing_order_outputs" ("manufacturing_order_batch_id");
CREATE INDEX IF NOT EXISTS "manufacturing_order_outputs_lot_id_idx"
  ON "manufacturing"."manufacturing_order_outputs" ("lot_id");
CREATE UNIQUE INDEX IF NOT EXISTS "manufacturing_order_outputs_order_number_uidx"
  ON "manufacturing"."manufacturing_order_outputs" ("manufacturing_order_id", "output_number");
CREATE INDEX IF NOT EXISTS "manufacturing_order_output_consumptions_output_id_idx"
  ON "manufacturing"."manufacturing_order_output_consumptions" ("manufacturing_order_output_id");
CREATE INDEX IF NOT EXISTS "manufacturing_order_output_consumptions_ingredient_id_idx"
  ON "manufacturing"."manufacturing_order_output_consumptions" ("manufacturing_order_ingredient_id");

ALTER TABLE "manufacturing"."manufacturing_order_outputs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "manufacturing"."manufacturing_order_outputs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "manufacturing"."manufacturing_order_output_consumptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "manufacturing"."manufacturing_order_output_consumptions" FORCE ROW LEVEL SECURITY;

CREATE POLICY "manufacturing_order_outputs_org_isolation"
  ON "manufacturing"."manufacturing_order_outputs"
  AS PERMISSIVE FOR ALL TO public
  USING ("manufacturing_order_id" IN (
    SELECT "id" FROM "manufacturing"."manufacturing_orders"
    WHERE "organization_id" = current_setting('app.current_org_id', true)
  ))
  WITH CHECK ("manufacturing_order_id" IN (
    SELECT "id" FROM "manufacturing"."manufacturing_orders"
    WHERE "organization_id" = current_setting('app.current_org_id', true)
  ));

CREATE POLICY "manufacturing_order_output_consumptions_org_isolation"
  ON "manufacturing"."manufacturing_order_output_consumptions"
  AS PERMISSIVE FOR ALL TO public
  USING ("manufacturing_order_output_id" IN (
    SELECT oo."id"
    FROM "manufacturing"."manufacturing_order_outputs" oo
    INNER JOIN "manufacturing"."manufacturing_orders" o
      ON o."id" = oo."manufacturing_order_id"
    WHERE o."organization_id" = current_setting('app.current_org_id', true)
  ))
  WITH CHECK ("manufacturing_order_output_id" IN (
    SELECT oo."id"
    FROM "manufacturing"."manufacturing_order_outputs" oo
    INNER JOIN "manufacturing"."manufacturing_orders" o
      ON o."id" = oo."manufacturing_order_id"
    WHERE o."organization_id" = current_setting('app.current_org_id', true)
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manufacturing"."manufacturing_order_outputs" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manufacturing"."manufacturing_order_output_consumptions" TO app_user;
