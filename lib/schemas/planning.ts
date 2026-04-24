import { z } from "zod";
import { isValidIsoDate, nullableString, positiveDecimalString } from "./shared";

const planningSourceRefSchema = z.object({
  sourceType: z.string().min(1),
  sourceId: z.string().min(1),
  label: z.string().min(1),
  itemId: z.string().optional(),
  quantity: z.string().optional(),
  date: z.string().nullable().optional(),
  parentSourceId: z.string().nullable().optional(),
});

const planningActionBaseSchema = z.object({
  inputHash: z.string().min(1),
  recommendationId: z.string().min(1),
  itemId: z.string().uuid(),
  quantity: positiveDecimalString("Quantity"),
  requiredDate: nullableString.refine(
    (value) => value == null || isValidIsoDate(value),
    "Required date must be a real date in YYYY-MM-DD format"
  ),
  sourceRefs: z.array(planningSourceRefSchema).default([]),
});

export const createPlanningPurchaseOrderDraftSchema =
  planningActionBaseSchema.extend({
    actionType: z.literal("create_purchase_order"),
    supplierId: z.string().uuid(),
    unitCost: positiveDecimalString("Unit cost"),
  });

export type CreatePlanningPurchaseOrderDraft = z.infer<
  typeof createPlanningPurchaseOrderDraftSchema
>;

export const createPlanningManufacturingOrderDraftSchema =
  planningActionBaseSchema.extend({
    actionType: z.literal("create_manufacturing_order"),
    bomRevisionId: z.string().uuid(),
    ingredients: z
      .array(
        z.object({
          itemId: z.string().uuid(),
          quantityPerUnit: positiveDecimalString("Quantity per unit"),
        })
      )
      .min(1),
  });

export type CreatePlanningManufacturingOrderDraft = z.infer<
  typeof createPlanningManufacturingOrderDraftSchema
>;
