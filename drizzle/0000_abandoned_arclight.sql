CREATE SCHEMA IF NOT EXISTS "inventory";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory"."unit_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(50) NOT NULL,
	"size" numeric(10, 4) NOT NULL,
	"uom" varchar(30) NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory"."items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"sku" varchar(50),
	"category" varchar(100),
	"item_type" varchar(20) DEFAULT 'material' NOT NULL,
	"unit_definition_id" uuid NOT NULL,
	"in_stock" numeric(12, 4) DEFAULT '0' NOT NULL,
	"safety_stock" numeric(12, 4) DEFAULT '0' NOT NULL,
	"committed_qty" numeric(12, 4) DEFAULT '0' NOT NULL,
	"expected_qty" numeric(12, 4) DEFAULT '0' NOT NULL,
	"default_purchase_price" numeric(10, 4),
	"default_selling_price" numeric(10, 2),
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory"."bom_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_item_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"quantity" numeric(12, 4),
	"percentage" numeric(5, 2),
	"uom" varchar(30),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_bom_component" UNIQUE("parent_item_id","component_id"),
	CONSTRAINT "no_self_reference" CHECK (parent_item_id != component_id)
);
--> statement-breakpoint ALTER TABLE "inventory"."items" DROP CONSTRAINT IF EXISTS "items_unit_definition_id_unit_definitions_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD CONSTRAINT "items_unit_definition_id_unit_definitions_id_fk" FOREIGN KEY ("unit_definition_id") REFERENCES "inventory"."unit_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint ALTER TABLE "inventory"."bom_components" DROP CONSTRAINT IF EXISTS "bom_components_parent_item_id_items_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."bom_components" ADD CONSTRAINT "bom_components_parent_item_id_items_id_fk" FOREIGN KEY ("parent_item_id") REFERENCES "inventory"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint ALTER TABLE "inventory"."bom_components" DROP CONSTRAINT IF EXISTS "bom_components_component_id_items_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."bom_components" ADD CONSTRAINT "bom_components_component_id_items_id_fk" FOREIGN KEY ("component_id") REFERENCES "inventory"."items"("id") ON DELETE restrict ON UPDATE no action;