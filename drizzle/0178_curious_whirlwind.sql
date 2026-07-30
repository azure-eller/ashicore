ALTER TABLE "purchasing"."purchase_order_additional_costs" DROP CONSTRAINT IF EXISTS "purchase_order_additional_costs_distribution_check";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_additional_costs" ADD CONSTRAINT "purchase_order_additional_costs_distribution_check" CHECK (distribution_method IN ('by_value', 'by_quantity', 'not_distributed'));
