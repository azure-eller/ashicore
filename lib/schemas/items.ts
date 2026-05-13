import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { items } from "@/lib/db/schema";
import { normalizeMinimumLotAgeDays } from "@/lib/bom/constraints";
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

const rawBomRowSchema = z.object({
  componentId: z.string().nullable().optional(),
  quantity: z.string().nullable().optional(),
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
  xeroPurchaseAccountCode: nullableStringOptional,
  currentStockUnitCost: currentStockUnitCostSchema,
  defaultSellingPrice: nullableString,
  sellable: z.boolean().default(true),
  description: nullableString,
  manufacturingMode: z.enum(["discrete", "batch"]).default("discrete"),
  expectedBatchYield: nullableStringOptional,
  safetyStock: z.string().transform((v) => (v.trim() === "" ? "0" : v)),
}).omit({
  id: true,
  organizationId: true,
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
  bom: cleanedBomRowsSchema.optional(),
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

function batchYieldRefine(
  data: { manufacturingMode?: string; expectedBatchYield?: string | null },
  ctx: z.RefinementCtx
) {
  if (data.manufacturingMode !== "batch") return;

  const raw = data.expectedBatchYield?.trim() ?? "";
  if (raw === "") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Expected batch yield is required for batch manufacturing",
      path: ["expectedBatchYield"],
    });
    return;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Expected batch yield must be greater than 0",
      path: ["expectedBatchYield"],
    });
  }
}

function bomRefine(
  data: { bom?: Array<{ componentId: string; alternates?: Array<{ itemId: string }> }> },
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

export const insertItemSchema = rawBaseItemSchema.superRefine((data, ctx) => {
  purchaseUnitRefine(data, ctx);
  bomRefine(data, ctx);
  batchYieldRefine(data, ctx);
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
  manufacturingMode: z.enum(["discrete", "batch"]),
  stock: z.string().refine(
    (v) => { const n = Number(v); return !isNaN(n) && n >= 0; },
    "Must be a non-negative number"
  ).optional(),
}).superRefine((data, ctx) => {
  purchaseUnitRefine(data, ctx);
  bomRefine(data, ctx);
  batchYieldRefine(data, ctx);
});

export type UpdateItem = z.infer<typeof updateItemSchema>;
export type UpdateItemFormValues = z.input<typeof updateItemSchema>;

// --- Master product schema (no stock, price, SKU, or purchase unit) ---

export const insertMasterItemSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: nullableStringOptional,
  category: nullableStringOptional,
  variantAxes: z.array(z.string().min(1)).min(1, "At least one variant axis is required"),
});

export type InsertMasterItem = z.infer<typeof insertMasterItemSchema>;
export type InsertMasterItemFormValues = z.input<typeof insertMasterItemSchema>;

// --- Variant schema (created under a master, minimal fields) ---

export const insertVariantSchema = z.object({
  unitDefinitionId: z.string().min(1, "Unit is required"),
  variantAttrs: z.record(z.string(), z.string().min(1, "Value is required")),
  sellable: z.boolean().default(true),
  sku: nullableStringOptional,
  description: nullableStringOptional,
  defaultSellingPrice: nullableStringOptional,
  defaultPurchasePrice: nullableStringOptional,
  safetyStock: z.string().default("0").refine(
    (v) => { const n = Number(v); return !isNaN(n) && n >= 0; },
    "Must be a non-negative number"
  ),
  manufacturingMode: z.enum(["discrete", "batch"]).default("discrete"),
  expectedBatchYield: nullableStringOptional,
  bom: cleanedBomRowsSchema.optional(),
  revisionNote: nullableStringOptional,
}).superRefine((data, ctx) => {
  batchYieldRefine(data, ctx);
  bomRefine(data, ctx);
});

export type InsertVariant = z.infer<typeof insertVariantSchema>;
export type InsertVariantFormValues = z.input<typeof insertVariantSchema>;

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
