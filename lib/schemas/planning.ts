import { z } from "zod";
import {
  isValidIsoDate,
  nonNegativeDecimalString,
  nullableString,
  positiveQuantityString,
} from "./shared";

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
  quantity: positiveQuantityString("Quantity"),
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
    unitCost: nonNegativeDecimalString("Unit cost"),
    purchaseUnitDefinitionId: z.string().uuid().nullable(),
    purchaseToStockFactor: positiveQuantityString("Purchase conversion factor"),
  });

export type CreatePlanningPurchaseOrderDraft = z.infer<
  typeof createPlanningPurchaseOrderDraftSchema
>;

export const createPlanningPurchaseOrderDraftsSchema = z.object({
  actions: z.array(createPlanningPurchaseOrderDraftSchema).min(1),
});

export type CreatePlanningPurchaseOrderDrafts = z.infer<
  typeof createPlanningPurchaseOrderDraftsSchema
>;

export const createPlanningManufacturingOrderDraftSchema =
  planningActionBaseSchema.extend({
    actionType: z.literal("create_manufacturing_order"),
    latestStartDate: nullableString.refine(
      (value) => value == null || isValidIsoDate(value),
      "Latest start date must be a real date in YYYY-MM-DD format"
    ),
    bomRevisionId: z.string().uuid(),
    ingredients: z
      .array(
        z.object({
          itemId: z.string().uuid(),
          quantityPerUnit: positiveQuantityString("Quantity per unit"),
        })
      )
      .min(1),
  });

export type CreatePlanningManufacturingOrderDraft = z.infer<
  typeof createPlanningManufacturingOrderDraftSchema
>;
