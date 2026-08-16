import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { items } from "@/lib/db/schema";
import { normalizeMinimumLotAgeDays } from "@/lib/bom/constraints";
import { normalizeNumeric, normalizeNumericScale } from "@/lib/format";
import {
  isNonNegativeNumberString,
  isPositiveNumberString,
  nonNegativeQuantityString,
  nullableString as nullableStringOptional,
  nullableStringPreserveUndefined,
  nullableStringStrict as nullableString,
  positiveQuantityString,
} from "./shared";

const optionalPositiveQuantitySchema = (label: string) =>
  nullableStringOptional.pipe(z.union([positiveQuantityString(label), z.null()]));

const bomQuantitySchema = nullableString
  .pipe(z.union([positiveQuantityString("Quantity"), z.null()]))
  .refine((value) => value != null, "Quantity is required")
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
  minimumLotAgeDays: minimumLotAgeDaysSchema,
  alternates: z
    .array(
      z.object({
        itemId: z.string().min(1, "Alternate is required"),
        // Typed in the alternate's own unit. Optional so recipes saved before alternates
        // carried a quantity keep loading; those fall back to the component's own number.
        quantity: bomQuantitySchema.optional(),
      }).strict()
    )
    .optional()
    .default([]),
}).strict();

const operationCostQuantitySchema = nullableString
  .refine((value) => value != null, "Value is required")
  .refine((value) => isPositiveNumberString(value), {
    message: "Value must be greater than 0",
  })
  .transform((value) => normalizeNumeric(Number(value)));

const operationCostRateSchema = nullableStringOptional
  .refine(
    (value) => value == null || isNonNegativeNumberString(value),
    "Loaded cost per hour must be a non-negative number"
  )
  .transform((value) => (value == null ? null : normalizeNumericScale(Number(value), 6)));

const operationCostRowSchema = z.object({
  operationName: z.string().trim().min(1, "Name is required"),
  resourceId: z.string().min(1, "Resource is required"),
  costScalingMode: z.literal("per_output_unit").default("per_output_unit"),
  crewSize: operationCostQuantitySchema,
  plannedMinutes: operationCostQuantitySchema,
  loadedCostPerHour: operationCostRateSchema,
});

const rawOperationCostRowSchema = z.object({
  operationName: z.string().nullable().optional(),
  resourceId: z.string().nullable().optional(),
  costScalingMode: z.literal("per_output_unit").nullable().optional(),
  crewSize: z.string().nullable().optional(),
  plannedMinutes: z.string().nullable().optional(),
  loadedCostPerHour: z.string().nullable().optional(),
});

const rawBomRowSchema = z.object({
  componentId: z.string().nullable().optional(),
  quantity: z.string().nullable().optional(),
  minimumLotAgeDays: z.union([z.string(), z.number()]).nullable().optional(),
  alternates: z
    .array(
      z.object({
        itemId: z.string().min(1, "Alternate is required"),
        // Typed in the alternate's own unit. Optional so recipes saved before alternates
        // carried a quantity keep loading; those fall back to the component's own number.
        quantity: bomQuantitySchema.optional(),
      }).strict()
    )
    .optional()
    .default([]),
}).strict();

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
  purchaseToStockFactor: optionalPositiveQuantitySchema("Conversion factor"),
  salesUnitDefinitionId: nullableStringOptional,
  salesToStockFactor: optionalPositiveQuantitySchema("Conversion factor"),
  sku: nullableString,
  category: nullableString,
  defaultPurchasePrice: nullableString,
  currentStockUnitCost: currentStockUnitCostSchema,
  defaultSellingPrice: nullableString,
  sellable: z.boolean().default(false),
  description: nullableString,
  manufacturingMode: z.enum(["discrete", "batch"]).default("discrete"),
  expectedBatchYield: optionalPositiveQuantitySchema("Expected batch yield"),
  typicalBatchSize: optionalPositiveQuantitySchema("Typical batch size"),
  standardCostQuantity: optionalPositiveQuantitySchema("Standard costing quantity"),
  safetyStock: z
    .string()
    .transform((v) => (v.trim() === "" ? "0" : v))
    .pipe(nonNegativeQuantityString("Safety stock")),
  registeredBarcode: nullableStringOptional,
  internalBarcode: nullableStringOptional,
  supplierItemCode: nullableStringOptional,
  defaultLeadTimeDays: z.coerce.number().int().nonnegative().nullable().optional(),
  minimumOrderQuantity: optionalPositiveQuantitySchema("Minimum order quantity"),
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
  stock: nonNegativeQuantityString("Stock").default("0"),
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

}

function salesUnitRefine(
  data: {
    unitDefinitionId?: string;
    salesUnitDefinitionId?: string | null;
    salesToStockFactor?: string | null;
  },
  ctx: z.RefinementCtx
) {
  if (data.salesUnitDefinitionId == null) {
    if (data.salesToStockFactor != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Sales conversion must be cleared with the sales unit",
        path: ["salesToStockFactor"],
      });
    }
    return;
  }

  if (data.salesUnitDefinitionId === data.unitDefinitionId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Sales unit must be different from the stocking unit",
      path: ["salesUnitDefinitionId"],
    });
  }

  const factor = data.salesToStockFactor?.trim() ?? "";
  if (factor === "") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Conversion factor must be greater than 0",
      path: ["salesToStockFactor"],
    });
  }
}

function batchModeRefine(
  data: { manufacturingMode?: "discrete" | "batch"; expectedBatchYield?: string | null },
  ctx: z.RefinementCtx
) {
  if (data.manufacturingMode !== "batch") return;
  if (!isPositiveNumberString(data.expectedBatchYield ?? "")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Expected batch yield is required for batch products",
      path: ["expectedBatchYield"],
    });
  }
}

function bomRefine(
  data: {
    bom?: Array<{
      componentId: string;
      alternates?: Array<{ itemId: string; quantity?: string | null }> | null;
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
    }>;
  },
  ctx: z.RefinementCtx
) {
  if (!data.operationCosts || data.operationCosts.length === 0) return;

  const seen = new Set<string>();
  for (let i = 0; i < data.operationCosts.length; i++) {
    const row = data.operationCosts[i];
    const key = `${row.operationName.trim().toLowerCase()}:${row.resourceId}`;
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
  salesUnitRefine(data, ctx);
  bomRefine(data, ctx);
  operationCostsRefine(data, ctx);
  batchModeRefine(data, ctx);
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
  stock: nonNegativeQuantityString("Stock").optional(),
}).superRefine((data, ctx) => {
  purchaseUnitRefine(data, ctx);
  salesUnitRefine(data, ctx);
  bomRefine(data, ctx);
  operationCostsRefine(data, ctx);
  batchModeRefine(data, ctx);
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
