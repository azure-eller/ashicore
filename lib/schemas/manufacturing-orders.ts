import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { manufacturingOrders } from "@/lib/db/schema";
import {
  isNonNegativeNumberString,
  isValidIsoDate,
  nullableString,
  positiveDecimalString,
} from "./shared";

export const MANUFACTURING_ORDER_STATUSES = ["open", "done"] as const;

export type ManufacturingOrderStatus =
  (typeof MANUFACTURING_ORDER_STATUSES)[number];

export const MANUFACTURING_PICK_STATUSES = [
  "not_picked",
  "in_progress",
  "picked",
] as const;

export type ManufacturingPickStatus =
  (typeof MANUFACTURING_PICK_STATUSES)[number];

export const MANUFACTURING_LOT_STRATEGIES = ["fifo", "lifo", "custom"] as const;

export type ManufacturingLotStrategy =
  (typeof MANUFACTURING_LOT_STRATEGIES)[number];

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
}).strict();

const rawIngredientRowSchema = z.object({
  itemId: z.string().nullable().optional(),
  quantityPerUnit: z.string().nullable().optional(),
}).strict();

function isBlankIngredientRow(row: z.input<typeof rawIngredientRowSchema>) {
  const itemId = row.itemId?.trim() ?? "";
  const quantityPerUnit = row.quantityPerUnit?.trim() ?? "";
  return itemId === "" && quantityPerUnit === "";
}

const cleanedIngredientRowsSchema = z
  .array(rawIngredientRowSchema)
  .transform((rows, ctx) => {
    const cleanedRows: Array<z.infer<typeof ingredientRowSchema>> = [];

    rows.forEach((row, index) => {
      if (isBlankIngredientRow(row)) return;

      const parsed = ingredientRowSchema.safeParse({
        itemId: row.itemId ?? "",
        quantityPerUnit: row.quantityPerUnit ?? null,
      });

      if (!parsed.success) {
        parsed.error.issues.forEach((issue) => {
          ctx.addIssue({
            ...issue,
            path: [index, ...issue.path],
          });
        });
        return;
      }

      cleanedRows.push(parsed.data);
    });

    return cleanedRows;
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

const ingredientsSchema = cleanedIngredientRowsSchema
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

const manufacturingIngredientLotAllocationSchema = z.object({
  itemId: z.string().min(1, "Ingredient is required"),
  allocations: z
    .array(
      z.object({
        sourceId: z.string().uuid(),
        quantity: positiveDecimalString("Allocated quantity"),
      })
    )
    .default([]),
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
    completedAt: true,
    cancelledAt: true,
    deletedAt: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    plannedQuantity: positiveDecimalString("Planned quantity"),
    batchCount: positiveDecimalString("Batches").optional(),
    ingredients: ingredientsSchema,
    lotAllocations: z
      .array(manufacturingIngredientLotAllocationSchema)
      .optional()
      .default([]),
    confirmShortage: z.boolean().optional(),
  })
  .strict();

export const insertManufacturingOrderSchema = baseManufacturingOrderSchema;
export type InsertManufacturingOrder = z.input<
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
    ingredients: cleanedIngredientRowsSchema,
    lotAllocations: z.array(manufacturingIngredientLotAllocationSchema).default([]),
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

export const updateManufacturingOrderSchema = baseManufacturingOrderSchema
  .omit({
    confirmShortage: true,
  })
  .extend({
    productId: z.string().min(1, "Product is required").optional(),
  });
export type UpdateManufacturingOrder = z.infer<
  typeof updateManufacturingOrderSchema
>;

/**
 * Nullable string normalizer for PATCH fields. Trims, maps "" → null, keeps
 * explicit null. Wrap with `.optional()` at the field so absent keys stay
 * `undefined` — the shared `nullableString` collapses undefined → null, which
 * would let a partial PATCH clobber unrelated columns.
 */
const patchNullableString = z
  .string()
  .nullable()
  .transform((value) => (value === null ? null : value.trim() || null));

/**
 * Partial patch for the inline-edit MO sheet. Each field is optional —
 * only the changed key arrives on the wire, and absent keys stay `undefined`.
 */
export const patchManufacturingOrderSchema = z
  .object({
    plannedDate: patchNullableString
      .refine(
        (value) => value == null || isValidIsoDate(value),
        "Planned date must be a real date in YYYY-MM-DD format",
      )
      .optional(),
    salesOrderId: patchNullableString.optional(),
    salesOrderLineId: patchNullableString.optional(),
    notes: patchNullableString.optional(),
    isBlocked: z.boolean().optional(),
  })
  .refine(
    (value) => Object.values(value).some((entry) => entry !== undefined),
    "Patch must include at least one field",
  );
export type PatchManufacturingOrder = z.infer<typeof patchManufacturingOrderSchema>;

/**
 * Per-ingredient PATCH — supports inline edits to lot strategy + (in v2)
 * planned quantity and explicit lot allocations. v1 keeps the schema minimal.
 */
export const patchManufacturingOrderIngredientSchema = z
  .object({
    lotStrategy: z.enum(MANUFACTURING_LOT_STRATEGIES).optional(),
    allocations: z
      .array(
        z.object({
          sourceId: z.string().uuid(),
          quantity: positiveDecimalString("Allocated quantity"),
        }),
      )
      .optional(),
  })
  .refine(
    (value) => Object.values(value).some((entry) => entry !== undefined),
    "Patch must include at least one field",
  );
export type PatchManufacturingOrderIngredient = z.infer<
  typeof patchManufacturingOrderIngredientSchema
>;

const ingredientActualSchema = z.object({
  ingredientId: z.string().min(1, "Ingredient is required"),
  actualConsumedQuantity: z
    .string()
    .trim()
    .min(1, "Actual consumed is required")
    .refine(isNonNegativeNumberString, "Actual consumed must be zero or greater"),
});

/**
 * Produced-lot selection (ERP-169). A production unit — one discrete MO, or one
 * batch of a batch MO — lands in exactly one lot. The caller may target an
 * existing lot (`producedLotId`) or name a new one (`producedLotNumber`); absent
 * both, the server generates a date lot. Ignored once the unit already has a lot.
 */
const producedLotSelectionFields = {
  producedLotId: z.string().uuid("Produced lot is invalid").optional(),
  producedLotNumber: z
    .string()
    .trim()
    .max(128, "Lot number must be 128 characters or fewer")
    .transform((value) => (value.length > 0 ? value : null))
    .optional(),
};

export const completeManufacturingOrderSchema = z.object({
  // Output + variance location; omitted = default (mobile sends none).
  locationId: z.string().uuid().nullish(),
  actualQuantity: positiveDecimalString("Actual quantity").nullish(),
  batchCount: z.number().int("Batches must be a whole number").positive("Batches must be positive").optional(),
  outputDisposition: z.enum(["available", "blocked"]).default("available"),
  ingredientActuals: z.array(ingredientActualSchema).default([]),
  confirmNegativeStock: z.boolean().optional(),
  ...producedLotSelectionFields,
});
export type CompleteManufacturingOrder = z.infer<
  typeof completeManufacturingOrderSchema
>;

export const completeManufacturingBatchSchema = z.object({
  // Output + variance location; omitted = default (mobile sends none).
  locationId: z.string().uuid().nullish(),
  actualQuantity: positiveDecimalString("Actual quantity").nullish(),
  outputDisposition: z.enum(["available", "blocked"]).default("available"),
  ingredientActuals: z.array(ingredientActualSchema).default([]),
  confirmNegativeStock: z.boolean().optional(),
  ...producedLotSelectionFields,
});
export type CompleteManufacturingBatch = z.infer<
  typeof completeManufacturingBatchSchema
>;

export const startManufacturingBatchSchema = z.object({});
export type StartManufacturingBatch = z.infer<
  typeof startManufacturingBatchSchema
>;

export const pickManufacturingIngredientSchema = z.object({
  // Pick location; omitted = default (mobile sends none).
  locationId: z.string().uuid().nullish(),
  confirmRequirementOverride: z.boolean().optional(),
  confirmNegativeStock: z.boolean().optional(),
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
  // Output location; a negative quantity reverses at this location too.
  // Omitted = default (mobile sends none).
  locationId: z.string().uuid().nullish(),
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
  confirmNegativeStock: z.boolean().optional(),
  ...producedLotSelectionFields,
});
export type RecordManufacturingOutput = z.infer<
  typeof recordManufacturingOutputSchema
>;

export const createManufacturingOrdersFromSalesOrderSchema = z.object({
  manufacturingStrategy: z
    .enum(["make_to_order", "make_to_stock"])
    .default("make_to_order"),
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
      }).strict()
    )
    .optional(),
  notes: nullableString,
}).strict();
export type CreateManufacturingOrdersFromSalesOrder = z.infer<
  typeof createManufacturingOrdersFromSalesOrderSchema
>;
export const manufacturingOrderDefaultValues: ManufacturingOrderCreateFormValues = {
  productId: "",
  salesOrderId: null,
  salesOrderLineId: null,
  priorityRank: null,
  plannedQuantity: "",
  plannedDate: null,
  notes: null,
  lotAllocations: [],
  ingredients: [],
  confirmShortage: true,
};
