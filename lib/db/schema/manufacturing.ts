import {
  check,
  date,
  boolean,
  index,
  integer,
  numeric,
  pgPolicy,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  bomRevisions,
  type BomComponentConstraintConfig,
} from "./bom";
import { items } from "./items";
import { lots } from "./lots";
import { salesOrders } from "./sales";

export const manufacturingSchema = pgSchema("manufacturing");

export const manufacturingOrders = manufacturingSchema
  .table(
    "manufacturing_orders",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      orderNumber: varchar("order_number", { length: 32 }).notNull(),
      productId: uuid("product_id")
        .notNull()
        .references(() => items.id),
      bomRevisionId: uuid("bom_revision_id").references(() => bomRevisions.id),
      salesOrderId: uuid("sales_order_id").references(() => salesOrders.id),
      // Stored as a plain UUID snapshot reference so draft sales-order edits can
      // replace line rows without being blocked by FK constraints.
      salesOrderLineId: uuid("sales_order_line_id"),
      productName: varchar("product_name", { length: 255 }).notNull(),
      productSku: varchar("product_sku", { length: 50 }),
      unitName: varchar("unit_name", { length: 50 }).notNull(),
      salesOrderNumber: varchar("sales_order_number", { length: 32 }),
      salesCustomerName: varchar("sales_customer_name", { length: 255 }),
      // Batch manufacturing snapshots (from product at creation time)
      manufacturingMode: varchar("manufacturing_mode", { length: 20 }).notNull().default("discrete"),
      numberOfBatches: integer("number_of_batches"),
      expectedBatchYield: numeric("expected_batch_yield", { precision: 12, scale: 4 }),
      requestedQuantity: numeric("requested_quantity", { precision: 12, scale: 4 })
        .notNull(),
      status: varchar("status", { length: 20 }).notNull().default("draft"),
      plannedQuantity: numeric("planned_quantity", { precision: 12, scale: 4 })
        .notNull(),
      actualQuantity: numeric("actual_quantity", { precision: 12, scale: 4 }),
      plannedDate: date("planned_date", { mode: "string" }),
      actualMaterialCost: numeric("actual_material_cost", {
        precision: 12,
        scale: 4,
      }),
      actualCostPerUnit: numeric("actual_cost_per_unit", {
        precision: 12,
        scale: 4,
      }),
      notes: text("notes"),
      releasedAt: timestamp("released_at"),
      completedAt: timestamp("completed_at"),
      cancelledAt: timestamp("cancelled_at"),
      deletedAt: timestamp("deleted_at"),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => [
      index("manufacturing_orders_org_id_idx").on(table.organizationId),
      index("manufacturing_orders_active_idx")
        .on(table.organizationId)
        .where(sql`deleted_at IS NULL`),
      index("manufacturing_orders_status_idx").on(table.status),
      index("manufacturing_orders_product_id_idx").on(table.productId),
      index("manufacturing_orders_bom_revision_id_idx").on(table.bomRevisionId),
      index("manufacturing_orders_sales_order_id_idx").on(table.salesOrderId),
      index("manufacturing_orders_planned_date_idx").on(table.plannedDate),
      index("manufacturing_orders_created_at_idx").on(table.createdAt),
      uniqueIndex("manufacturing_orders_org_order_number_uidx").on(
        table.organizationId,
        table.orderNumber
      ),
      pgPolicy("manufacturing_orders_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();

export const manufacturingOrderIngredients = manufacturingSchema
  .table(
    "manufacturing_order_ingredients",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      manufacturingOrderId: uuid("manufacturing_order_id")
        .notNull()
        .references(() => manufacturingOrders.id, { onDelete: "cascade" }),
      manufacturingOrderBatchId: uuid("manufacturing_order_batch_id").references(
        () => manufacturingOrderBatches.id,
        { onDelete: "cascade" }
      ),
      itemId: uuid("item_id")
        .notNull()
        .references(() => items.id),
      itemName: varchar("item_name", { length: 255 }).notNull(),
      itemSku: varchar("item_sku", { length: 50 }),
      itemType: varchar("item_type", { length: 20 }).notNull(),
      unitName: varchar("unit_name", { length: 50 }).notNull(),
      quantityPerUnit: numeric("quantity_per_unit", { precision: 12, scale: 4 })
        .notNull(),
      plannedQuantity: numeric("planned_quantity", { precision: 12, scale: 4 })
        .notNull(),
      pickedQuantity: numeric("picked_quantity", { precision: 12, scale: 4 })
        .notNull()
        .default("0"),
      pickStatus: varchar("pick_status", { length: 20 }).notNull().default("not_picked"),
      pickedAt: timestamp("picked_at"),
      actualQuantity: numeric("actual_quantity", { precision: 12, scale: 4 }),
      actualCostTotal: numeric("actual_cost_total", {
        precision: 12,
        scale: 4,
      }),
      sortOrder: integer("sort_order").notNull().default(0),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => [
      index("manufacturing_order_ingredients_order_id_idx").on(
        table.manufacturingOrderId
      ),
      index("manufacturing_order_ingredients_batch_id_idx").on(
        table.manufacturingOrderBatchId
      ),
      index("manufacturing_order_ingredients_item_id_idx").on(table.itemId),
      uniqueIndex("manufacturing_order_ingredients_template_item_uidx")
        .on(table.manufacturingOrderId, table.itemId)
        .where(sql`${table.manufacturingOrderBatchId} IS NULL`),
      uniqueIndex("manufacturing_order_ingredients_batch_item_uidx")
        .on(table.manufacturingOrderBatchId, table.itemId)
        .where(sql`${table.manufacturingOrderBatchId} IS NOT NULL`),
      pgPolicy("manufacturing_order_ingredients_org_isolation", {
        for: "all",
        to: "public",
        using: sql`manufacturing_order_id IN (
          SELECT id
          FROM manufacturing.manufacturing_orders
          WHERE organization_id = current_setting('app.current_org_id', true)
        )`,
        withCheck: sql`manufacturing_order_id IN (
          SELECT id
          FROM manufacturing.manufacturing_orders
          WHERE organization_id = current_setting('app.current_org_id', true)
        )`,
      }),
    ]
  )
  .enableRLS();

export const manufacturingOrderBatches = manufacturingSchema
  .table(
    "manufacturing_order_batches",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      manufacturingOrderId: uuid("manufacturing_order_id")
        .notNull()
        .references(() => manufacturingOrders.id, { onDelete: "cascade" }),
      batchNumber: integer("batch_number").notNull(),
      status: varchar("status", { length: 20 }).notNull().default("pending"),
      plannedQuantity: numeric("planned_quantity", { precision: 12, scale: 4 })
        .notNull(),
      actualQuantity: numeric("actual_quantity", { precision: 12, scale: 4 }),
      startedAt: timestamp("started_at"),
      pickedAt: timestamp("picked_at"),
      completedAt: timestamp("completed_at"),
      lotId: uuid("lot_id").references(() => lots.id),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => [
      index("manufacturing_order_batches_order_id_idx").on(table.manufacturingOrderId),
      index("manufacturing_order_batches_status_idx").on(table.status),
      uniqueIndex("manufacturing_order_batches_order_batch_uidx").on(
        table.manufacturingOrderId,
        table.batchNumber
      ),
      pgPolicy("manufacturing_order_batches_org_isolation", {
        for: "all",
        to: "public",
        using: sql`manufacturing_order_id IN (
          SELECT id
          FROM manufacturing.manufacturing_orders
          WHERE organization_id = current_setting('app.current_org_id', true)
        )`,
        withCheck: sql`manufacturing_order_id IN (
          SELECT id
          FROM manufacturing.manufacturing_orders
          WHERE organization_id = current_setting('app.current_org_id', true)
        )`,
      }),
    ]
  )
  .enableRLS();

export const manufacturingPickAllocations = manufacturingSchema
  .table(
    "manufacturing_pick_allocations",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      manufacturingOrderIngredientId: uuid("manufacturing_order_ingredient_id")
        .notNull()
        .references(() => manufacturingOrderIngredients.id, { onDelete: "cascade" }),
      lotId: uuid("lot_id")
        .notNull()
        .references(() => lots.id),
      quantityUsed: numeric("quantity_used", { precision: 12, scale: 4 }).notNull(),
      costPerUnit: numeric("cost_per_unit", { precision: 18, scale: 6 }),
      requirementOverrideConfirmed: boolean("requirement_override_confirmed")
        .notNull()
        .default(false),
      requirementOverrideConfirmedBy: text("requirement_override_confirmed_by"),
      requirementOverrideConfirmedAt: timestamp("requirement_override_confirmed_at"),
      createdBy: text("created_by").notNull(),
      createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (table) => [
      index("manufacturing_pick_allocations_ingredient_id_idx").on(
        table.manufacturingOrderIngredientId
      ),
      pgPolicy("manufacturing_pick_allocations_org_isolation", {
        for: "all",
        to: "public",
        using: sql`manufacturing_order_ingredient_id IN (
          SELECT i.id
          FROM manufacturing.manufacturing_order_ingredients i
          INNER JOIN manufacturing.manufacturing_orders o
            ON o.id = i.manufacturing_order_id
          WHERE o.organization_id = current_setting('app.current_org_id', true)
        )`,
        withCheck: sql`manufacturing_order_ingredient_id IN (
          SELECT i.id
          FROM manufacturing.manufacturing_order_ingredients i
          INNER JOIN manufacturing.manufacturing_orders o
            ON o.id = i.manufacturing_order_id
          WHERE o.organization_id = current_setting('app.current_org_id', true)
        )`,
      }),
    ]
  )
  .enableRLS();

export const manufacturingOrderIngredientConstraints = manufacturingSchema
  .table(
    "manufacturing_order_ingredient_constraints",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      manufacturingOrderIngredientId: uuid("manufacturing_order_ingredient_id")
        .notNull()
        .references(() => manufacturingOrderIngredients.id, { onDelete: "cascade" }),
      constraintType: varchar("constraint_type", { length: 64 }).notNull(),
      config: jsonb("config").$type<BomComponentConstraintConfig>().notNull(),
      sortOrder: integer("sort_order").notNull().default(0),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => [
      index("manufacturing_order_ingredient_constraints_ingredient_id_idx").on(
        table.manufacturingOrderIngredientId
      ),
      uniqueIndex("manufacturing_order_ingredient_constraints_type_uidx").on(
        table.manufacturingOrderIngredientId,
        table.constraintType
      ),
      check(
        "manufacturing_order_ingredient_constraints_type_check",
        sql`constraint_type IN ('lot_age_min_days')`
      ),
      check(
        "manufacturing_order_ingredient_constraints_config_check",
        sql`constraint_type <> 'lot_age_min_days'
          OR (
            config->>'basis' = 'received_at'
            AND (config->>'days') ~ '^[1-9][0-9]*$'
          )`
      ),
      pgPolicy("manufacturing_order_ingredient_constraints_org_isolation", {
        for: "all",
        to: "public",
        using: sql`manufacturing_order_ingredient_id IN (
          SELECT i.id
          FROM manufacturing.manufacturing_order_ingredients i
          INNER JOIN manufacturing.manufacturing_orders o
            ON o.id = i.manufacturing_order_id
          WHERE o.organization_id = current_setting('app.current_org_id', true)
        )`,
        withCheck: sql`manufacturing_order_ingredient_id IN (
          SELECT i.id
          FROM manufacturing.manufacturing_order_ingredients i
          INNER JOIN manufacturing.manufacturing_orders o
            ON o.id = i.manufacturing_order_id
          WHERE o.organization_id = current_setting('app.current_org_id', true)
        )`,
      }),
    ]
  )
  .enableRLS();
