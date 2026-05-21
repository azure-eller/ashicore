import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { items } from "@/lib/db/schema";
import { normalizeMinimumLotAgeDays } from "@/lib/bom/constraints";
import { normalizeNumeric, normalizeNumericScale } from "@/lib/format";
import {
  BATCH_SCALING_MODES,
  CONSUMPTION_MODES,
  GROUP_REMAINDER_POLICIES,
} from "@/lib/manufacturing/consumption";
import { OPERATION_COST_SCALING_MODES } from "@/lib/manufacturing/operation-costs";
import {
  isNonNegativeNumberString,
  nullableString as nullableStringOptional,
  nullableStringPreserveUndefined,
  nullableStringStrict as nullableString,
} from "./shared";

const bomQuantitySchema = nullableString
  .refine((value) => value != null, "Quantity is required")
  .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, {
    message: "Quantity must be greater than 0",
  })
  .transform((value) => value as string);

const minimumLotAgeDaysSchema = z
  .union([z.string(), z.number()])
  .nullable()
  .optional()
  .refine((value) => {
    const normalized = normalizeMinimumLotAgeDays(value);
    return !Number.isNaN(normalized);
  }, "Minimum lot age must be a positive whole number of days")
  .transform((value) => normalizeMinimumLotAgeDays(value));

const bomRowSchema = z.object({
  componentId: z.string().min(1, "Component is required"),
  quantity: bomQuantitySchema,
  everyQuantity: bomQuantitySchema.optional(),
  consumptionMode: z.enum(CONSUMPTION_MODES).default("per_output_unit"),
  basisOutputQuantity: nullableStringOptional,
  batchScalingMode: z.enum(BATCH_SCALING_MODES).nullable().optional(),
  groupRemainderPolicy: z.enum(GROUP_REMAINDER_POLICIES).nullable().optional(),
  minimumLotAgeDays: minimumLotAgeDaysSchema,
  alternates: z
    .array(
      z.object({
        itemId: z.string().min(1, "Alternate is required"),
      })
    )
    .optional()
    .default([]),
});

const operationCostQuantitySchema = nullableString
  .refine((value) => value != null, "Value is required")
  .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, {
    message: "Value must be greater than 0",
  })
  .transform((value) => normalizeNumeric(Number(value)));

const operationCostRateSchema = nullableStringOptional
  .refine(
    (value) => value == null || (Number.isFinite(Number(value)) && Number(value) >= 0),
    "Loaded cost per hour must be a non-negative number"
  )
  .transform((value) => (value == null ? null : normalizeNumericScale(Number(value), 6)));

const operationCostRowSchema = z.object({
  operationName: z.string().trim().min(1, "Name is required"),
  resourceId: z.string().min(1, "Resource is required"),
  costScalingMode: z.enum(OPERATION_COST_SCALING_MODES).default("per_output_unit"),
  crewSize: operationCostQuantitySchema,
  plannedMinutes: operationCostQuantitySchema,
  loadedCostPerHour: operationCostRateSchema,
});

const rawOperationCostRowSchema = z.object({
  operationName: z.string().nullable().optional(),
  resourceId: z.string().nullable().optional(),
  costScalingMode: z.enum(OPERATION_COST_SCALING_MODES).nullable().optional(),
  crewSize: z.string().nullable().optional(),
  plannedMinutes: z.string().nullable().optional(),
  loadedCostPerHour: z.string().nullable().optional(),
});

const rawBomRowSchema = z.object({
  componentId: z.string().nullable().optional(),
  quantity: z.string().nullable().optional(),
  everyQuantity: z.string().nullable().optional(),
  consumptionMode: z.enum(CONSUMPTION_MODES).nullable().optional(),
  basisOutputQuantity: z.string().nullable().optional(),
  batchScalingMode: z.enum(BATCH_SCALING_MODES).nullable().optional(),
  groupRemainderPolicy: z.enum(GROUP_REMAINDER_POLICIES).nullable().optional(),
  minimumLotAgeDays: z.union([z.string(), z.number()]).nullable().optional(),
  alternates: z
    .array(
      z.object({
        itemId: z.string().min(1, "Alternate is required"),
      })
    )
    .optional()
    .default([]),
});

function isBlankBomRow(row: z.input<typeof rawBomRowSchema>) {
  const componentId = row.componentId?.trim() ?? "";
  const quantity = row.quantity?.trim() ?? "";
  const minimumLotAgeDays =
    row.minimumLotAgeDays == null ? "" : String(row.minimumLotAgeDays).trim();

  return componentId === "" && quantity === "" && minimumLotAgeDays === "";
}

function isBlankOperationCostRow(row: z.input<typeof rawOperationCostRowSchema>) {
  const operationName = row.operationName?.trim() ?? "";
  const resourceId = row.resourceId?.trim() ?? "";
  const crewSize = row.crewSize?.trim() ?? "";
  const plannedMinutes = row.plannedMinutes?.trim() ?? "";

  return operationName === "" && resourceId === "" && crewSize === "" && plannedMinutes === "";
}

const cleanedBomRowsSchema = z
  .array(rawBomRowSchema)
  .transform((rows, ctx) => {
    const cleanedRows: Array<z.infer<typeof bomRowSchema>> = [];

    rows.forEach((row, index) => {
      if (isBlankBomRow(row)) {
        return;
      }

      const parsed = bomRowSchema.safeParse({
        componentId: row.componentId ?? "",
        quantity: row.quantity ?? null,
        everyQuantity: row.everyQuantity ?? row.basisOutputQuantity ?? undefined,
        consumptionMode: row.consumptionMode ?? "per_output_unit",
        basisOutputQuantity: row.basisOutputQuantity ?? null,
        batchScalingMode: row.batchScalingMode ?? null,
        groupRemainderPolicy: row.groupRemainderPolicy ?? null,
        minimumLotAgeDays: row.minimumLotAgeDays,
        alternates: row.alternates,
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

const cleanedOperationCostRowsSchema = z
  .array(rawOperationCostRowSchema)
  .transform((rows, ctx) => {
    const cleanedRows: Array<z.infer<typeof operationCostRowSchema>> = [];

    rows.forEach((row, index) => {
      if (isBlankOperationCostRow(row)) {
        return;
      }

      const parsed = operationCostRowSchema.safeParse({
        operationName: row.operationName ?? "",
        resourceId: row.resourceId ?? "",
        costScalingMode: row.costScalingMode ?? "per_output_unit",
        crewSize: row.crewSize ?? null,
        plannedMinutes: row.plannedMinutes ?? null,
        loadedCostPerHour: row.loadedCostPerHour ?? null,
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

const currentStockUnitCostMessage =
  "Current stock unit cost must be a non-negative number";

const currentStockUnitCostSchema = nullableStringOptional.refine(
  (value) => value == null || isNonNegativeNumberString(value),
  currentStockUnitCostMessage
);

const currentStockUnitCostUpdateSchema = nullableStringPreserveUndefined.refine(
  (value) => value == null || isNonNegativeNumberString(value),
  currentStockUnitCostMessage
);

// Base schema without superRefine — used as the foundation for both insert and update.
// superRefine can't be applied before .omit(), so we split it out.
const rawBaseItemSchema = createInsertSchema(items, {
  name: z.string().min(1, "Name is required"),
  itemType: z.enum(["product", "material"]),
  unitDefinitionId: z.string().min(1, "Unit is required"),
  purchaseUnitDefinitionId: nullableStringOptional,
  purchaseToStockFactor: nullableStringOptional,
  sku: nullableString,
  category: nullableString,
  defaultPurchasePrice: nullableString,
  currentStockUnitCost: currentStockUnitCostSchema,
  defaultSellingPrice: nullableString,
  sellable: z.boolean().default(false),
  description: nullableString,
  manufacturingMode: z.enum(["discrete", "batch"]).default("discrete"),
  expectedBatchYield: nullableStringOptional,
  typicalBatchSize: nullableStringOptional,
  typicalGroupSize: nullableStringOptional,
  standardCostQuantity: nullableStringOptional,
  safetyStock: z.string().transform((v) => (v.trim() === "" ? "0" : v)),
  registeredBarcode: nullableStringOptional,
  internalBarcode: nullableStringOptional,
  supplierItemCode: nullableStringOptional,
  defaultLeadTimeDays: z.coerce.number().int().nonnegative().nullable().optional(),
  minimumOrderQuantity: nullableStringOptional,
}).omit({
  id: true,
  organizationId: true,
  familyId: true,
  optionCombinationKey: true,
  isMaster: true,
  parentId: true,
  variantAxes: true,
  variantAttrs: true,
  bomLockedAt: true,
  bomLockedByUserId: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  stock: z.string().default("0").refine(
    (v) => { const n = Number(v); return !isNaN(n) && n >= 0; },
    "Must be a non-negative number"
  ),
  outputQuantity: bomQuantitySchema.optional(),
  bom: cleanedBomRowsSchema.optional(),
  operationCosts: cleanedOperationCostRowsSchema.optional(),
  revisionNote: nullableStringOptional,
});

function purchaseUnitRefine(
  data: {
    unitDefinitionId?: string;
    purchaseUnitDefinitionId?: string | null;
    purchaseToStockFactor?: string | null;
  },
  ctx: z.RefinementCtx
) {
  if (data.purchaseUnitDefinitionId == null) {
    return;
  }

  if (data.purchaseUnitDefinitionId === data.unitDefinitionId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Purchase unit must be different from the stocking unit",
      path: ["purchaseUnitDefinitionId"],
    });
  }

  const factor = data.purchaseToStockFactor?.trim() ?? "";
  if (factor === "") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Conversion factor is required when a purchase unit is set",
      path: ["purchaseToStockFactor"],
    });
    return;
  }

  const parsed = Number(factor);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Conversion factor must be greater than 0",
      path: ["purchaseToStockFactor"],
    });
  }
}

function positiveOptionalRefine(
  value: string | null | undefined,
  fieldName: string,
  path: string,
  ctx: z.RefinementCtx
) {
  const raw = value?.trim() ?? "";
  if (raw === "") return;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${fieldName} must be greater than 0`,
      path: [path],
    });
  }
}

function bomRefine(
  data: {
    bom?: Array<{
      componentId: string;
      consumptionMode?: string;
      basisOutputQuantity?: string | null;
      everyQuantity?: string | null;
      batchScalingMode?: string | null;
      groupRemainderPolicy?: string | null;
      alternates?: Array<{ itemId: string }>;
    }>;
  },
  ctx: z.RefinementCtx
) {
  if (!data.bom || data.bom.length === 0) return;
  const seen = new Set<string>();
  for (let i = 0; i < data.bom.length; i++) {
    if (seen.has(data.bom[i].componentId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate component",
        path: ["bom", i, "componentId"],
      });
    }
    seen.add(data.bom[i].componentId);

    const row = data.bom[i];
    const everyQuantity = row.everyQuantity?.trim() ?? row.basisOutputQuantity?.trim() ?? "";
    if (everyQuantity !== "") {
      const parsed = Number(everyQuantity);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Every must be greater than 0",
          path: ["bom", i, "everyQuantity"],
        });
      }
    }

    const alternatesSeen = new Set<string>();
    for (let j = 0; j < (data.bom[i].alternates ?? []).length; j++) {
      const alternateItemId = data.bom[i].alternates?.[j]?.itemId;
      if (!alternateItemId) continue;

      if (alternateItemId === data.bom[i].componentId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Alternate must be different from the default component",
          path: ["bom", i, "alternates", j, "itemId"],
        });
      }

      if (alternatesSeen.has(alternateItemId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Duplicate alternate",
          path: ["bom", i, "alternates", j, "itemId"],
        });
      }
      alternatesSeen.add(alternateItemId);
    }
  }
}

function operationCostsRefine(
  data: {
    operationCosts?: Array<{
      operationName: string;
      resourceId: string;
      costScalingMode: string;
    }>;
  },
  ctx: z.RefinementCtx
) {
  if (!data.operationCosts || data.operationCosts.length === 0) return;

  const seen = new Set<string>();
  for (let i = 0; i < data.operationCosts.length; i++) {
    const row = data.operationCosts[i];
    const key = `${row.operationName.trim().toLowerCase()}:${row.resourceId}:${row.costScalingMode}`;
    if (seen.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate operation cost",
        path: ["operationCosts", i, "operationName"],
      });
    }
    seen.add(key);
  }
}

export const insertItemSchema = rawBaseItemSchema.superRefine((data, ctx) => {
  purchaseUnitRefine(data, ctx);
  bomRefine(data, ctx);
  operationCostsRefine(data, ctx);
  positiveOptionalRefine(data.outputQuantity, "Recipe output", "outputQuantity", ctx);
  positiveOptionalRefine(data.expectedBatchYield, "Expected batch yield", "expectedBatchYield", ctx);
  positiveOptionalRefine(data.typicalBatchSize, "Typical batch size", "typicalBatchSize", ctx);
  positiveOptionalRefine(data.typicalGroupSize, "Typical group size", "typicalGroupSize", ctx);
  positiveOptionalRefine(data.standardCostQuantity, "Standard costing quantity", "standardCostQuantity", ctx);
  positiveOptionalRefine(data.minimumOrderQuantity, "Minimum order quantity", "minimumOrderQuantity", ctx);
});

export type InsertItem = z.infer<typeof insertItemSchema>;
export type InsertItemFormValues = z.input<typeof insertItemSchema>;

// Update schema: itemType, unitDefinitionId are immutable after creation.
// stock is optional — if provided, triggers a stock adjustment.
// bom is inherited from baseItemSchema — no need to re-add it.
export const updateItemSchema = rawBaseItemSchema.omit({
  itemType: true,
  unitDefinitionId: true,
  stock: true,
}).extend({
  currentStockUnitCost: currentStockUnitCostUpdateSchema,
  sellable: z.boolean().optional(),
  manufacturingMode: z.enum(["discrete", "batch"]).default("discrete"),
  stock: z.string().refine(
    (v) => { const n = Number(v); return !isNaN(n) && n >= 0; },
    "Must be a non-negative number"
  ).optional(),
}).superRefine((data, ctx) => {
  purchaseUnitRefine(data, ctx);
  bomRefine(data, ctx);
  operationCostsRefine(data, ctx);
  positiveOptionalRefine(data.outputQuantity, "Recipe output", "outputQuantity", ctx);
  positiveOptionalRefine(data.expectedBatchYield, "Expected batch yield", "expectedBatchYield", ctx);
  positiveOptionalRefine(data.typicalBatchSize, "Typical batch size", "typicalBatchSize", ctx);
  positiveOptionalRefine(data.typicalGroupSize, "Typical group size", "typicalGroupSize", ctx);
  positiveOptionalRefine(data.standardCostQuantity, "Standard costing quantity", "standardCostQuantity", ctx);
  positiveOptionalRefine(data.minimumOrderQuantity, "Minimum order quantity", "minimumOrderQuantity", ctx);
});

export type UpdateItem = z.infer<typeof updateItemSchema>;
export type UpdateItemFormValues = z.input<typeof updateItemSchema>;

export const overrideCurrentStockUnitCostSchema = z.object({
  currentStockUnitCost: z
    .string()
    .trim()
    .min(1, "Current stock unit cost is required")
    .refine(isNonNegativeNumberString, currentStockUnitCostMessage),
});

export type OverrideCurrentStockUnitCost = z.infer<
  typeof overrideCurrentStockUnitCostSchema
>;
