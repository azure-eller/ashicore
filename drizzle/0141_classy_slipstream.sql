ALTER TABLE "sales"."sales_order_lines" ADD COLUMN IF NOT EXISTS "shipped_quantity" numeric(12, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
UPDATE "sales"."sales_order_lines" AS sol
SET "shipped_quantity" = LEAST(sol."quantity" - sol."cancelled_quantity", shipped.shipped_quantity)
FROM (
	SELECT
		ssl."sales_order_line_id",
		COALESCE(SUM(ssl."quantity"), 0)::numeric(12, 4) AS shipped_quantity
	FROM "sales"."sales_shipment_lines" AS ssl
	INNER JOIN "sales"."sales_shipments" AS ss
		ON ss."id" = ssl."sales_shipment_id"
	WHERE ss."status" = 'shipped'
	GROUP BY ssl."sales_order_line_id"
) AS shipped
WHERE sol."id" = shipped."sales_order_line_id";--> statement-breakpoint
UPDATE "inventory"."inventory_events" AS event
SET
	"reference_type" = 'sales_order',
	"reference_id" = shipment."sales_order_id",
	"metadata" = jsonb_set(
		COALESCE(event."metadata", '{}'::jsonb),
		'{salesOrderId}',
		to_jsonb(shipment."sales_order_id"::text),
		true
	)
FROM "sales"."sales_shipments" AS shipment
WHERE event."reference_type" = 'sales_shipment'
	AND event."reference_id" = shipment."id";--> statement-breakpoint
UPDATE "inventory"."inventory_events"
SET
	"reference_type" = 'sales_order',
	"reference_id" = ("metadata"->>'salesOrderId')::uuid
WHERE "reference_type" = 'sales_shipment'
	AND "metadata" ? 'salesOrderId'
	AND "metadata"->>'salesOrderId' <> '';--> statement-breakpoint
DELETE FROM "accounting"."document_syncs"
WHERE "document_type" = 'sales_shipment';--> statement-breakpoint
DROP POLICY IF EXISTS "sales_shipment_costs_org_isolation" ON "sales"."sales_shipment_costs" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "sales"."sales_shipment_costs" CASCADE;--> statement-breakpoint
DROP POLICY IF EXISTS "sales_shipment_lines_org_isolation" ON "sales"."sales_shipment_lines" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "sales"."sales_shipment_lines" CASCADE;--> statement-breakpoint
DROP POLICY IF EXISTS "sales_shipments_org_isolation" ON "sales"."sales_shipments" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "sales"."sales_shipments" CASCADE;--> statement-breakpoint
ALTER TABLE "inventory"."onboarding_sessions" ALTER COLUMN "current_step" SET DEFAULT 'import';--> statement-breakpoint
ALTER TABLE "sales"."sales_order_lines" DROP CONSTRAINT IF EXISTS "sales_order_lines_cancelled_quantity_check";--> statement-breakpoint
ALTER TABLE "sales"."sales_order_lines" ADD CONSTRAINT "sales_order_lines_cancelled_quantity_check" CHECK (cancelled_quantity >= 0 AND shipped_quantity >= 0 AND cancelled_quantity + shipped_quantity <= quantity);
