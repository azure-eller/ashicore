CREATE TABLE "sales"."customer_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales"."customer_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales"."customer_categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sales"."pricing_schedule_breaks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pricing_schedule_id" uuid NOT NULL,
	"min_quantity" numeric(12, 4) NOT NULL,
	"max_quantity" numeric(12, 4),
	"discount_percent" numeric(5, 2) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales"."pricing_schedule_breaks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales"."pricing_schedule_breaks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sales"."pricing_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"customer_category_id" uuid,
	"unit_definition_id" uuid NOT NULL,
	"notes" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales"."pricing_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales"."pricing_schedules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD COLUMN "customer_category_id" uuid;--> statement-breakpoint
ALTER TABLE "sales"."sales_order_lines" ADD COLUMN "suggested_unit_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "sales"."sales_order_lines" ADD COLUMN "pricing_source_type" varchar(30);--> statement-breakpoint
ALTER TABLE "sales"."sales_order_lines" ADD COLUMN "pricing_schedule_name" varchar(255);--> statement-breakpoint
ALTER TABLE "sales"."sales_order_lines" ADD COLUMN "pricing_break_label" varchar(50);--> statement-breakpoint
ALTER TABLE "sales"."sales_order_lines" ADD COLUMN "is_price_overridden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sales"."pricing_schedule_breaks" ADD CONSTRAINT "pricing_schedule_breaks_pricing_schedule_id_pricing_schedules_id_fk" FOREIGN KEY ("pricing_schedule_id") REFERENCES "sales"."pricing_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."pricing_schedules" ADD CONSTRAINT "pricing_schedules_customer_category_id_customer_categories_id_fk" FOREIGN KEY ("customer_category_id") REFERENCES "sales"."customer_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."pricing_schedules" ADD CONSTRAINT "pricing_schedules_unit_definition_id_unit_definitions_id_fk" FOREIGN KEY ("unit_definition_id") REFERENCES "inventory"."unit_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_customer_categories_org_id_idx" ON "sales"."customer_categories" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sales_customer_categories_active_idx" ON "sales"."customer_categories" USING btree ("organization_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "sales_customer_categories_name_idx" ON "sales"."customer_categories" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_customer_categories_org_name_uidx" ON "sales"."customer_categories" USING btree ("organization_id","name") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "sales_pricing_schedule_breaks_schedule_id_idx" ON "sales"."pricing_schedule_breaks" USING btree ("pricing_schedule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_pricing_schedule_breaks_schedule_sort_uidx" ON "sales"."pricing_schedule_breaks" USING btree ("pricing_schedule_id","sort_order");--> statement-breakpoint
CREATE INDEX "sales_pricing_schedules_org_id_idx" ON "sales"."pricing_schedules" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sales_pricing_schedules_active_idx" ON "sales"."pricing_schedules" USING btree ("organization_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "sales_pricing_schedules_customer_category_id_idx" ON "sales"."pricing_schedules" USING btree ("customer_category_id");--> statement-breakpoint
CREATE INDEX "sales_pricing_schedules_unit_definition_id_idx" ON "sales"."pricing_schedules" USING btree ("unit_definition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_pricing_schedules_scope_uidx" ON "sales"."pricing_schedules" USING btree ("organization_id","customer_category_id","unit_definition_id") WHERE customer_category_id IS NOT NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_pricing_schedules_everyone_uidx" ON "sales"."pricing_schedules" USING btree ("organization_id","unit_definition_id") WHERE customer_category_id IS NULL AND deleted_at IS NULL;--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD CONSTRAINT "customers_customer_category_id_customer_categories_id_fk" FOREIGN KEY ("customer_category_id") REFERENCES "sales"."customer_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_customers_customer_category_id_idx" ON "sales"."customers" USING btree ("customer_category_id");--> statement-breakpoint
CREATE POLICY "sales_customer_categories_org_isolation" ON "sales"."customer_categories" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "sales_pricing_schedule_breaks_org_isolation" ON "sales"."pricing_schedule_breaks" AS PERMISSIVE FOR ALL TO public USING (pricing_schedule_id IN (
          SELECT id
          FROM sales.pricing_schedules
          WHERE organization_id = current_setting('app.current_org_id', true)
        )) WITH CHECK (pricing_schedule_id IN (
          SELECT id
          FROM sales.pricing_schedules
          WHERE organization_id = current_setting('app.current_org_id', true)
        ));--> statement-breakpoint
CREATE POLICY "sales_pricing_schedules_org_isolation" ON "sales"."pricing_schedules" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
GRANT USAGE ON SCHEMA "sales" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "sales"."customer_categories" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "sales"."pricing_schedules" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "sales"."pricing_schedule_breaks" TO app_user;
