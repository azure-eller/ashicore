import { z } from "zod";
import { LOT_TRACKING_MODES } from "@/lib/inventory/lot-tracking";
import {
  expectedVersionSchema,
  isNonNegativeNumberString,
  nullableString,
  nullableStringPreserveUndefined,
  optionalMoneyString,
  optionalNonNegativeDecimalInputPreserveUndefined,
  optionalNonNegativeDecimalString,
  optionalPositiveDecimalString,
  optionalPositiveDecimalStringPreserveUndefined,
  optionalPositiveNumeric12Scale4String,
  optionalPositiveNumeric12Scale4StringPreserveUndefined,
} from "./shared";

const nullableText = nullableString;
const patchNullableText = nullableStringPreserveUndefined;

export const lotTrackingModeSchema = z.enum(LOT_TRACKING_MODES);

export const itemCardCreateSchema = z.object({
  itemType: z.enum(["product", "material"]),
  name: z.string().trim().min(1, "Name is required"),
  category: nullableText,
  description: nullableText,
  unitDefinitionId: z.string().uuid("Unit is required"),
  defaultSupplierId: z.string().uuid().nullable().optional(),
  purchaseUnitDefinitionId: z.string().uuid().nullable().optional(),
  purchaseToStockFactor: optionalPositiveDecimalString("Purchase-to-stock factor"),
  salesUnitDefinitionId: z.string().uuid().nullable().optional(),
  salesToStockFactor: optionalPositiveNumeric12Scale4String(
    "Sales-to-stock factor",
  ),
  sku: nullableText,
  sellable: z.boolean().optional(),
  defaultSellingPrice: optionalMoneyString("Default selling price"),
  defaultPurchasePrice: optionalMoneyString("Default purchase price"),
  currentStockUnitCost: optionalNonNegativeDecimalString("Current stock unit cost"),
  registeredBarcode: nullableText,
  internalBarcode: nullableText,
  supplierItemCode: nullableText,
  defaultLeadTimeDays: z.number().int().nonnegative().nullable().optional(),
  minimumOrderQuantity: optionalPositiveDecimalString("Minimum order quantity"),
  lotTrackingMode: lotTrackingModeSchema.optional(),
}).superRefine((data, ctx) => {
  if (data.itemType === "product") {
    for (const field of [
      "defaultSupplierId",
      "purchaseUnitDefinitionId",
      "purchaseToStockFactor",
    ] as const) {
      if (data[field] != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: "This field is only supported for material cards",
        });
      }
    }
  }

  if (
    data.itemType === "material" &&
    data.purchaseUnitDefinitionId &&
    !data.purchaseToStockFactor
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["purchaseToStockFactor"],
      message: "Purchase-to-stock factor is required when purchase unit is set",
    });
  }

  if (
    data.salesUnitDefinitionId &&
    data.salesUnitDefinitionId !== data.unitDefinitionId &&
    !data.salesToStockFactor
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["salesToStockFactor"],
      message: "Sales-to-stock factor is required when sales unit is set",
    });
  }
  if (data.salesUnitDefinitionId == null && data.salesToStockFactor != null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["salesToStockFactor"],
      message: "Sales-to-stock factor must be cleared with the sales unit",
    });
  }
});

export const itemCardUpdateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").optional(),
  category: patchNullableText,
  description: patchNullableText,
  unitDefinitionId: z.string().uuid("Unit is required").optional(),
  defaultSupplierId: z.string().uuid().nullable().optional(),
  purchaseUnitDefinitionId: z.string().uuid().nullable().optional(),
  purchaseToStockFactor: optionalPositiveDecimalStringPreserveUndefined(
    "Purchase-to-stock factor",
  ),
  salesUnitDefinitionId: z.string().uuid().nullable().optional(),
  salesToStockFactor: optionalPositiveNumeric12Scale4StringPreserveUndefined(
    "Sales-to-stock factor",
  ),
  lotTrackingMode: lotTrackingModeSchema.optional(),
}).superRefine((data, ctx) => {
  if (
    data.purchaseUnitDefinitionId &&
    data.purchaseToStockFactor === null
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["purchaseToStockFactor"],
      message: "Purchase-to-stock factor is required when purchase unit is set",
    });
  }
  if (data.salesUnitDefinitionId === null && data.salesToStockFactor != null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["salesToStockFactor"],
      message: "Sales-to-stock factor must be cleared with the sales unit",
    });
  }
});

/**
 * Variant-level fields that live on `inventory.items` rows. All fields are
 * optional — only those present are applied.
 */
export const itemCardVariantUpdateSchema = z.object({
  sku: patchNullableText,
  registeredBarcode: patchNullableText,
  internalBarcode: patchNullableText,
  supplierItemCode: patchNullableText,
  defaultLeadTimeDays: z.number().int().nonnegative().nullable().optional(),
  minimumOrderQuantity: optionalPositiveDecimalStringPreserveUndefined(
    "Minimum order quantity",
  ),
  defaultSellingPrice: optionalNonNegativeDecimalInputPreserveUndefined(
    "Default selling price",
  ),
  defaultPurchasePrice: optionalNonNegativeDecimalInputPreserveUndefined(
    "Default purchase price",
  ),
  currentStockUnitCost: optionalNonNegativeDecimalInputPreserveUndefined(
    "Current stock unit cost",
  ),
  safetyStock: z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      return value.trim() || "0";
    })
    .refine(
      (value) => value == null || isNonNegativeNumberString(value),
      "Safety stock must be a non-negative number",
    ),
  sellable: z.boolean().optional(),
  optionValueIdsByOptionId: z
    // Migration 0107 deterministically generated PostgreSQL UUID values before
    // RFC version/variant bits were enforced. They are valid database UUIDs,
    // so accept the canonical UUID shape rather than rejecting our own rows.
    .record(z.guid(), z.guid())
    .optional(),
});

export const itemCardVariantCreateSchema = itemCardVariantUpdateSchema.extend({
  optionValueIdsByOptionId: z.record(z.guid(), z.guid()),
});

/**
 * The consolidated item-card document PATCH: family fields, per-variant
 * fields (matched by items row id), and variant ordering compose in one
 * transaction, replacing the family/variant/sellable/reorder endpoint
 * fan-out.
 */
export const itemCardDocUpdateSchema = z
  .object({
    family: itemCardUpdateSchema.optional(),
    variants: z
      .array(itemCardVariantUpdateSchema.extend({ id: z.string().uuid() }))
      .optional(),
    variantOrder: z.array(z.string().uuid()).min(1).optional(),
    expectedVersion: expectedVersionSchema,
  })
  // Reject flat (pre-doc) bodies loudly instead of stripping them to a no-op.
  .strict();

export type ItemCardDocUpdateInput = z.infer<typeof itemCardDocUpdateSchema>;
