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

const ingredientRowSchema = z.object({
  itemId: z.string().min(1, "Ingredient is required"),
  quantityPerUnit: positiveDecimalString("Quantity per unit"),
});

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
    salesOrderNumber: true,
    salesCustomerName: true,
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

export const completeManufacturingOrderSchema = z.object({
  actualQuantity: positiveDecimalString("Actual quantity"),
});
export type CompleteManufacturingOrder = z.infer<
  typeof completeManufacturingOrderSchema
>;

export const deleteManufacturingOrdersSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

export const manufacturingOrderDefaultValues: InsertManufacturingOrder = {
  productId: "",
  salesOrderId: null,
  salesOrderLineId: null,
  plannedQuantity: "",
  plannedDate: null,
  notes: null,
  ingredients: [],
  confirmShortage: false,
};
