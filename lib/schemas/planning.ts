import { z } from "zod";
import { normalizeNumeric } from "@/lib/format";
import { isValidIsoDate, nullableString, positiveDecimalString } from "./shared";

function nullableDecimalString(
  label: string,
  options: { positive?: boolean } = {}
) {
  return z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      if (value == null) return null;
      const raw = typeof value === "number" ? String(value) : value.trim();
      return raw === "" ? null : raw;
    })
    .refine((value) => {
      if (value == null) return true;
      const parsed = Number(value);
      return (
        Number.isFinite(parsed) &&
        (options.positive ? parsed > 0 : parsed >= 0)
      );
    }, `${label} must be ${options.positive ? "greater than 0" : "0 or greater"}`)
    .transform((value) =>
      value == null ? value : normalizeNumeric(Number(value))
    );
}

function nullableDayCount(label: string) {
  return nullableDecimalString(label, { positive: true });
}

const nonNegativeDecimalString = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .refine((value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed >= 0;
    }, `${label} must be 0 or greater`);

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
    unitCost: nonNegativeDecimalString("Unit cost"),
    purchaseUnitDefinitionId: z.string().uuid().nullable(),
    purchaseToStockFactor: positiveDecimalString("Purchase conversion factor"),
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
          quantityPerUnit: positiveDecimalString("Quantity per unit"),
        })
      )
      .min(1),
  });

export type CreatePlanningManufacturingOrderDraft = z.infer<
  typeof createPlanningManufacturingOrderDraftSchema
>;

const planningSupplierItemSchema = z
  .object({
    supplierId: z.string().uuid().nullable().optional(),
    supplierSku: nullableString,
    unitCost: nullableDecimalString("Unit cost"),
    purchaseUnitDefinitionId: z.string().uuid().nullable().optional(),
    purchaseToStockFactor: nullableDecimalString("Purchase conversion factor", {
      positive: true,
    }),
    leadTimeDaysOverride: nullableDayCount("Lead time"),
    minimumOrderQuantity: nullableDecimalString("Minimum order quantity", {
      positive: true,
    }),
    orderMultiple: nullableDecimalString("Order multiple", { positive: true }),
    isPreferred: z.boolean().default(true),
  })
  .nullable();

export const updatePlanningRulesSchema = z.object({
  planningEnabled: z.boolean().optional(),
  reorderPoint: nullableDecimalString("Reorder point"),
  targetCoverDays: nullableDayCount("Target cover days"),
  leadTimeDaysOverride: nullableDayCount("Lead time"),
  productionLeadTimeDays: nullableDayCount("Production lead time"),
  preferredSupplierItem: planningSupplierItemSchema.optional(),
});

export type UpdatePlanningRules = z.infer<typeof updatePlanningRulesSchema>;
