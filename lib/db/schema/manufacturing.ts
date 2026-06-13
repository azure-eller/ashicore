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
  bomRevisionOperationCosts,
  bomRevisions,
  type BomComponentConstraintConfig,
} from "./bom";
import { items } from "./items";
import { inventoryLocations } from "./locations";
import { lots } from "./lots";
import { salesOrders } from "./sales";
import { manufacturingResources } from "./manufacturing-resources";

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
      // Stored as a plain UUID snapshot reference so sales-order edits can
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
      status: varchar("status", { length: 20 }).notNull().default("open"),
      isBlocked: boolean("is_blocked").notNull().default(false),
      priorityRank: integer("priority_rank"),
      plannedQuantity: numeric("planned_quantity", { precision: 12, scale: 4 })
        .notNull(),
      actualQuantity: numeric("actual_quantity", { precision: 12, scale: 4 }),
      plannedDate: date("planned_date", { mode: "string" }),
      actualMaterialCost: numeric("actual_material_cost", {
        precision: 12,
        scale: 4,
      }),
      actualOperationsCost: numeric("actual_operations_cost", {
        precision: 18,
        scale: 6,
      }),
      actualCostPerUnit: numeric("actual_cost_per_unit", {
        precision: 12,
        scale: 4,
      }),
      notes: text("notes"),
      startedAt: timestamp("started_at", { withTimezone: true }),
      completedAt: timestamp("completed_at", { withTimezone: true }),
      cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("manufacturing_orders_org_id_idx").on(table.organizationId),
      index("manufacturing_orders_active_idx")
        .on(table.organizationId)
        .where(sql`deleted_at IS NULL`),
      index("manufacturing_orders_status_idx").on(table.status),
      index("manufacturing_orders_priority_rank_idx")
        .on(table.organizationId, table.status, table.priorityRank)
        .where(sql`deleted_at IS NULL AND priority_rank IS NOT NULL`),
      uniqueIndex("manufacturing_orders_active_priority_rank_uidx")
        .on(table.organizationId, table.priorityRank)
        .where(
          sql`deleted_at IS NULL AND priority_rank IS NOT NULL AND status = 'open'`
        ),
      index("manufacturing_orders_product_id_idx").on(table.productId),
      index("manufacturing_orders_bom_revision_id_idx").on(table.bomRevisionId),
      index("manufacturing_orders_sales_order_id_idx").on(table.salesOrderId),
      index("manufacturing_orders_planned_date_idx").on(table.plannedDate),
      index("manufacturing_orders_created_at_idx").on(table.createdAt),
      uniqueIndex("manufacturing_orders_org_order_number_uidx").on(
        table.organizationId,
        table.orderNumber
      ),
      check("manufacturing_orders_priority_rank_positive_check", sql`${table.priorityRank} > 0`),
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
      lotStrategy: varchar("lot_strategy", { length: 16 })
        .notNull()
        .default("fifo"),
      pickedQuantity: numeric("picked_quantity", { precision: 12, scale: 4 })
        .notNull()
        .default("0"),
      pickStatus: varchar("pick_status", { length: 20 }).notNull().default("not_picked"),
      pickedAt: timestamp("picked_at", { withTimezone: true }),
      actualQuantity: numeric("actual_quantity", { precision: 12, scale: 4 }),
      actualCostTotal: numeric("actual_cost_total", {
        precision: 12,
        scale: 4,
      }),
      sortOrder: integer("sort_order").notNull().default(0),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
      check(
        "manufacturing_order_ingredients_lot_strategy_check",
        sql`lot_strategy IN ('fifo', 'lifo', 'custom')`
      ),
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
      startedAt: timestamp("started_at", { withTimezone: true }),
      pickedAt: timestamp("picked_at", { withTimezone: true }),
      completedAt: timestamp("completed_at", { withTimezone: true }),
      lotId: uuid("lot_id").references(() => lots.id),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
      // Where the pick consumed stock; null = the default location (legacy
      // rows and single-location orgs). Unpick restores here.
      locationId: uuid("location_id").references(() => inventoryLocations.id),
      quantityUsed: numeric("quantity_used", { precision: 12, scale: 4 }).notNull(),
      costPerUnit: numeric("cost_per_unit", { precision: 18, scale: 6 }),
      requirementOverrideConfirmed: boolean("requirement_override_confirmed")
        .notNull()
        .default(false),
      requirementOverrideConfirmedBy: text("requirement_override_confirmed_by"),
      requirementOverrideConfirmedAt: timestamp("requirement_override_confirmed_at", { withTimezone: true }),
      createdBy: text("created_by").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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

export const manufacturingOrderOutputs = manufacturingSchema
  .table(
    "manufacturing_order_outputs",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      manufacturingOrderId: uuid("manufacturing_order_id")
        .notNull()
        .references(() => manufacturingOrders.id, { onDelete: "cascade" }),
      manufacturingOrderBatchId: uuid("manufacturing_order_batch_id").references(
        () => manufacturingOrderBatches.id,
        { onDelete: "cascade" }
      ),
      lotId: uuid("lot_id")
        .notNull()
        .references(() => lots.id),
      // Where this output's finished goods landed; null = legacy rows (the
      // default location) and reversal marker rows (which can span source
      // locations). Output reversal decrements exactly here.
      locationId: uuid("location_id").references(() => inventoryLocations.id),
      outputNumber: integer("output_number").notNull(),
      quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull(),
      // How much of this row later reversals took back. Kept per row because
      // reversal markers don't reference their source rows, and replaying the
      // walk order misattributes once an output is recorded after a reversal.
      reversedQuantity: numeric("reversed_quantity", { precision: 12, scale: 4 })
        .notNull()
        .default("0"),
      disposition: varchar("disposition", { length: 24 }).notNull().default("available"),
      unitCost: numeric("unit_cost", { precision: 18, scale: 6 }).notNull(),
      materialCostTotal: numeric("material_cost_total", {
        precision: 18,
        scale: 6,
      }).notNull(),
      notes: text("notes"),
      createdBy: text("created_by").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("manufacturing_order_outputs_order_id_idx").on(
        table.manufacturingOrderId
      ),
      index("manufacturing_order_outputs_batch_id_idx").on(
        table.manufacturingOrderBatchId
      ),
      index("manufacturing_order_outputs_lot_id_idx").on(table.lotId),
      uniqueIndex("manufacturing_order_outputs_order_number_uidx").on(
        table.manufacturingOrderId,
        table.outputNumber
      ),
      check(
        "manufacturing_order_outputs_disposition_check",
        sql`disposition IN ('available', 'blocked')`
      ),
      pgPolicy("manufacturing_order_outputs_org_isolation", {
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

export const manufacturingOrderOperationCosts = manufacturingSchema
  .table(
    "manufacturing_order_operation_costs",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      manufacturingOrderId: uuid("manufacturing_order_id")
        .notNull()
        .references(() => manufacturingOrders.id, { onDelete: "cascade" }),
      sourceBomRevisionOperationCostId: uuid("source_bom_revision_operation_cost_id")
        .references(() => bomRevisionOperationCosts.id, { onDelete: "set null" }),
      resourceId: uuid("resource_id").references(() => manufacturingResources.id, {
        onDelete: "restrict",
      }),
      operationName: varchar("operation_name", { length: 255 }).notNull(),
      resourceName: varchar("resource_name", { length: 255 }).notNull(),
      resourceType: varchar("resource_type", { length: 20 }).notNull(),
      costScalingMode: varchar("cost_scaling_mode", { length: 30 }).notNull(),
      crewSize: numeric("crew_size", { precision: 12, scale: 4 }).notNull(),
      plannedMinutes: numeric("planned_minutes", {
        precision: 12,
        scale: 4,
      }).notNull(),
      plannedQuantityBasis: numeric("planned_quantity_basis", {
        precision: 12,
        scale: 4,
      }),
      loadedCostPerHour: numeric("loaded_cost_per_hour", {
        precision: 18,
        scale: 6,
      }).notNull(),
      plannedCostTotal: numeric("planned_cost_total", {
        precision: 18,
        scale: 6,
      }).notNull(),
      actualCrewSize: numeric("actual_crew_size", { precision: 12, scale: 4 }),
      actualMinutes: numeric("actual_minutes", { precision: 12, scale: 4 }),
      actualCostTotal: numeric("actual_cost_total", {
        precision: 18,
        scale: 6,
      }),
      sortOrder: integer("sort_order").notNull().default(0),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("manufacturing_order_operation_costs_order_idx").on(
        table.manufacturingOrderId
      ),
      index("manufacturing_order_operation_costs_source_idx").on(
        table.sourceBomRevisionOperationCostId
      ),
      check(
        "manufacturing_order_operation_costs_scaling_mode_check",
        sql`cost_scaling_mode IN ('per_output_unit', 'fixed_per_mo')`
      ),
      check("manufacturing_order_operation_costs_crew_check", sql`crew_size > 0`),
      check(
        "manufacturing_order_operation_costs_minutes_check",
        sql`planned_minutes > 0`
      ),
      check(
        "manufacturing_order_operation_costs_rate_check",
        sql`loaded_cost_per_hour >= 0`
      ),
      check(
        "manufacturing_order_operation_costs_total_check",
        sql`planned_cost_total >= 0`
      ),
      pgPolicy("manufacturing_order_operation_costs_org_isolation", {
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

export const manufacturingOrderOutputConsumptions = manufacturingSchema
  .table(
    "manufacturing_order_output_consumptions",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      manufacturingOrderOutputId: uuid("manufacturing_order_output_id")
        .notNull()
        .references(() => manufacturingOrderOutputs.id, { onDelete: "cascade" }),
      manufacturingOrderIngredientId: uuid("manufacturing_order_ingredient_id")
        .notNull()
        .references(() => manufacturingOrderIngredients.id, { onDelete: "cascade" }),
      lotId: uuid("lot_id")
        .notNull()
        .references(() => lots.id),
      // Where this consumption drew stock; null = the default location
      // (legacy rows). Output reversal restores exactly here.
      locationId: uuid("location_id").references(() => inventoryLocations.id),
      quantityUsed: numeric("quantity_used", { precision: 12, scale: 4 }).notNull(),
      costPerUnit: numeric("cost_per_unit", { precision: 18, scale: 6 }).notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("manufacturing_order_output_consumptions_output_id_idx").on(
        table.manufacturingOrderOutputId
      ),
      index("manufacturing_order_output_consumptions_ingredient_id_idx").on(
        table.manufacturingOrderIngredientId
      ),
      pgPolicy("manufacturing_order_output_consumptions_org_isolation", {
        for: "all",
        to: "public",
        using: sql`manufacturing_order_output_id IN (
          SELECT oo.id
          FROM manufacturing.manufacturing_order_outputs oo
          INNER JOIN manufacturing.manufacturing_orders o
            ON o.id = oo.manufacturing_order_id
          WHERE o.organization_id = current_setting('app.current_org_id', true)
        )`,
        withCheck: sql`manufacturing_order_output_id IN (
          SELECT oo.id
          FROM manufacturing.manufacturing_order_outputs oo
          INNER JOIN manufacturing.manufacturing_orders o
            ON o.id = oo.manufacturing_order_id
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
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
