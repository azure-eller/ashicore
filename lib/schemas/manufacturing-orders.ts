import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { manufacturingOrders } from "@/lib/db/schema";
import { isValidIsoDate, nullableString, positiveDecimalString } from "./shared";

export const MANUFACTURING_ORDER_STATUSES = [
  "draft",
  "released",
  "completed",
  "cancelled",
] as const;

export type ManufacturingOrderStatus =
  (typeof MANUFACTURING_ORDER_STATUSES)[number];

export const MANUFACTURING_PICK_STATUSES = [
  "not_picked",
  "in_progress",
  "picked",
] as const;

export type ManufacturingPickStatus =
  (typeof MANUFACTURING_PICK_STATUSES)[number];

export const MANUFACTURING_BATCH_STATUSES = [
  "pending",
  "in_progress",
  "completed",
] as const;

export type ManufacturingBatchStatus =
  (typeof MANUFACTURING_BATCH_STATUSES)[number];

const ingredientRowSchema = z.object({
  itemId: z.string().min(1, "Ingredient is required"),
  quantityPerUnit: positiveDecimalString("Quantity per unit"),
});

const priorityRankSchema = z
  .union([
    z.number().int("Priority rank must be a whole number").positive("Priority rank must be positive"),
    z
      .string()
      .trim()
      .regex(/^\d+$/, "Priority rank must be a whole number")
      .transform((value) => Number(value)),
  ])
  .nullable()
  .optional()
  .transform((value) => value ?? null)
  .refine((value) => value == null || value > 0, "Priority rank must be positive");

const ingredientsSchema = z
  .array(ingredientRowSchema)
  .min(1, "At least one ingredient is required")
  .superRefine((rows, ctx) => {
    const seen = new Set<string>();

    rows.forEach((row, index) => {
      if (seen.has(row.itemId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "This ingredient is already on the order",
          path: [index, "itemId"],
        });
      }
      seen.add(row.itemId);
    });
  });

const baseManufacturingOrderSchema = createInsertSchema(manufacturingOrders, {
  productId: z.string().min(1, "Product is required"),
  salesOrderId: nullableString,
  salesOrderLineId: nullableString,
  priorityRank: priorityRankSchema,
  plannedDate: nullableString.refine(
    (value) => value == null || isValidIsoDate(value),
    "Planned date must be a real date in YYYY-MM-DD format"
  ),
  notes: nullableString,
})
  .omit({
    id: true,
    organizationId: true,
    orderNumber: true,
    productName: true,
    productSku: true,
    unitName: true,
    bomRevisionId: true,
    salesOrderNumber: true,
    salesCustomerName: true,
    requestedQuantity: true,
    status: true,
    actualQuantity: true,
    actualMaterialCost: true,
    actualCostPerUnit: true,
    releasedAt: true,
    completedAt: true,
    cancelledAt: true,
    deletedAt: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    plannedQuantity: positiveDecimalString("Planned quantity"),
    ingredients: ingredientsSchema,
    confirmShortage: z.boolean().optional(),
  });

export const insertManufacturingOrderSchema = baseManufacturingOrderSchema;
export type InsertManufacturingOrder = z.infer<
  typeof insertManufacturingOrderSchema
>;

export const manufacturingOrderCreateFormSchema = z
  .object({
    salesOrderId: nullableString,
    salesOrderLineId: nullableString,
    productId: nullableString,
    plannedQuantity: nullableString,
    priorityRank: priorityRankSchema,
    plannedDate: nullableString.refine(
      (value) => value == null || isValidIsoDate(value),
      "Planned date must be a real date in YYYY-MM-DD format"
    ),
    notes: nullableString,
    ingredients: z.array(ingredientRowSchema),
    confirmShortage: z.boolean().optional(),
  })
  .superRefine((values, ctx) => {
    if (values.salesOrderId != null) {
      return;
    }

    if (!values.productId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Product is required",
        path: ["productId"],
      });
    }

    const quantityCheck = positiveDecimalString("Planned quantity").safeParse(
      values.plannedQuantity ?? ""
    );

    if (!quantityCheck.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: quantityCheck.error.issues[0]?.message ?? "Planned quantity is required",
        path: ["plannedQuantity"],
      });
    }

    const ingredientsCheck = ingredientsSchema.safeParse(values.ingredients);

    if (!ingredientsCheck.success) {
      ingredientsCheck.error.issues.forEach((issue) => {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: issue.message,
          path: ["ingredients", ...issue.path],
        });
      });
    }
  });
export type ManufacturingOrderCreateFormValues = z.infer<
  typeof manufacturingOrderCreateFormSchema
>;

export const updateManufacturingOrderSchema = baseManufacturingOrderSchema.omit({
  productId: true,
  confirmShortage: true,
});
export type UpdateManufacturingOrder = z.infer<
  typeof updateManufacturingOrderSchema
>;

export const releaseManufacturingOrderSchema = z.object({
  confirmShortage: z.boolean().optional(),
});
export type ReleaseManufacturingOrder = z.infer<
  typeof releaseManufacturingOrderSchema
>;

const ingredientActualSchema = z.object({
  ingredientId: z.string().min(1, "Ingredient is required"),
  actualConsumedQuantity: z
    .string()
    .trim()
    .min(1, "Actual consumed is required")
    .refine((value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed >= 0;
    }, "Actual consumed must be zero or greater"),
});

export const completeManufacturingOrderSchema = z.object({
  actualQuantity: positiveDecimalString("Actual quantity").optional(),
  outputDisposition: z.enum(["available", "blocked"]).default("available"),
  ingredientActuals: z.array(ingredientActualSchema).default([]),
});
export type CompleteManufacturingOrder = z.infer<
  typeof completeManufacturingOrderSchema
>;

export const completeManufacturingBatchSchema = z.object({
  actualQuantity: positiveDecimalString("Actual quantity").optional(),
  outputDisposition: z.enum(["available", "blocked"]).default("available"),
  ingredientActuals: z.array(ingredientActualSchema).default([]),
});
export type CompleteManufacturingBatch = z.infer<
  typeof completeManufacturingBatchSchema
>;

export const startManufacturingBatchSchema = z.object({});
export type StartManufacturingBatch = z.infer<
  typeof startManufacturingBatchSchema
>;

export const pickManufacturingIngredientSchema = z.object({
  confirmRequirementOverride: z.boolean().optional(),
});
export type PickManufacturingIngredient = z.infer<
  typeof pickManufacturingIngredientSchema
>;

export const reorderManufacturingIngredientsSchema = z.object({
  ingredientIds: z
    .array(z.string().min(1, "Ingredient is required"))
    .min(1, "At least one ingredient is required")
    .superRefine((ids, ctx) => {
      const seen = new Set<string>();

      ids.forEach((id, index) => {
        if (seen.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Ingredient appears more than once",
            path: [index],
          });
        }
        seen.add(id);
      });
    }),
});
export type ReorderManufacturingIngredients = z.infer<
  typeof reorderManufacturingIngredientsSchema
>;

export const updateManufacturingOrderPrioritySchema = z.object({
  priorityRank: priorityRankSchema,
});
export type UpdateManufacturingOrderPriority = z.infer<
  typeof updateManufacturingOrderPrioritySchema
>;

export const reorderManufacturingOrderPriorityRanksSchema = z.object({
  orderIds: z
    .array(z.string().uuid("Manufacturing order is required"))
    .min(1, "At least one manufacturing order is required")
    .superRefine((ids, ctx) => {
      const seen = new Set<string>();

      ids.forEach((id, index) => {
        if (seen.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Manufacturing order appears more than once",
            path: [index],
          });
        }
        seen.add(id);
      });
    }),
});
export type ReorderManufacturingOrderPriorityRanks = z.infer<
  typeof reorderManufacturingOrderPriorityRanksSchema
>;

export const recordManufacturingOutputSchema = z.object({
  quantity: z
    .string()
    .trim()
    .min(1, "Output quantity is required")
    .refine((value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed !== 0;
    }, "Output quantity must be a non-zero number"),
  outputDisposition: z.enum(["available", "blocked"]).default("available"),
  notes: nullableString,
});
export type RecordManufacturingOutput = z.infer<
  typeof recordManufacturingOutputSchema
>;

export const createManufacturingOrdersFromSalesOrderSchema = z.object({
  plannedDate: nullableString.refine(
    (value) => value == null || isValidIsoDate(value),
    "Planned date must be a real date in YYYY-MM-DD format"
  ),
  salesOrderLineIds: z
    .array(z.string().uuid("Sales order line is required"))
    .min(1, "Select at least one manufacturing order to create"),
  priorityRank: priorityRankSchema,
  lineQuantities: z
    .array(
      z.object({
        salesOrderLineId: z.string().uuid("Sales order line is required"),
        quantity: positiveDecimalString("Quantity"),
      })
    )
    .optional(),
  notes: nullableString,
});
export type CreateManufacturingOrdersFromSalesOrder = z.infer<
  typeof createManufacturingOrdersFromSalesOrderSchema
>;
export const manufacturingOrderDefaultValues: InsertManufacturingOrder = {
  productId: "",
  salesOrderId: null,
  salesOrderLineId: null,
  priorityRank: null,
  plannedQuantity: "",
  plannedDate: null,
  notes: null,
  ingredients: [],
  confirmShortage: false,
};
