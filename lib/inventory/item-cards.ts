import "server-only";

import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  itemFamilies,
  itemVariantValues,
  items,
  inventoryItemBalances,
  inventoryEvents,
  bomRevisionComponents,
  bomRevisions,
  lots,
  manufacturingOrderIngredients,
  manufacturingOrders,
  purchaseOrderLines,
  purchaseOrders,
  salesOrderLines,
  salesOrders,
  stockAllocations,
  stocktakeItems,
  stocktakes,
  supplierItems,
  unitDefinitions,
  variantOptionValues,
  variantOptions,
} from "@/lib/db/schema";
import { trimScaleNullable } from "@/lib/db/numeric";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { DomainError } from "@/lib/errors/domain-error";
import {
  beginInventoryOperationInTx,
  finishInventoryOperationInTx,
} from "@/lib/inventory/kernel";
import {
  nullableStringPreserveUndefined,
  optionalMoneyString,
  optionalNonNegativeDecimalString,
} from "@/lib/schemas/shared";
import { normalizeNumeric } from "@/lib/format";
import type { Tx } from "@/lib/db/with-org-context";
import type {
  DuplicateCombinationWarning,
  ItemType,
  VariantOptionValueDisplay,
} from "@/app/(dashboard)/inventory/types";

export class ItemCardError extends DomainError {
  constructor(message: string, status = 400) {
    super(message, status, { name: "ItemCardError" });
  }
}

const nullableText = z
  .string()
  .nullable()
  .optional()
  .transform((value) => (value != null ? value.trim() || null : null));

const patchNullableText = nullableStringPreserveUndefined;

const positiveOptionalDecimalString = (label: string) =>
  optionalNonNegativeDecimalString(label).refine(
    (value) => value == null || Number(value) > 0,
    `${label} must be greater than 0`,
  );

const patchPositiveOptionalDecimalString = (label: string) =>
  z
    .string()
    .nullable()
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      return value != null ? value.trim() || null : null;
    })
    .refine(
      (value) => value == null || (Number.isFinite(Number(value)) && Number(value) > 0),
      `${label} must be greater than 0`,
    )
    .transform((value) =>
      value == null ? value : normalizeNumeric(Number(value)),
    );

const variantOptionValueInputSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().trim().min(1, "Value label is required"),
  code: z.string().trim().min(1).optional(),
  sortOrder: z.number().int().nonnegative().optional(),
});

export const variantConfigSchema = z.object({
  options: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1, "Option name is required"),
        code: z.string().trim().min(1).optional(),
        sortOrder: z.number().int().nonnegative().optional(),
        values: z
          .array(variantOptionValueInputSchema)
          .max(40, "At most 40 values per option are supported")
          .default([]),
      }),
    )
    .max(10, "At most 10 variant options are supported"),
});

export const itemCardCreateSchema = z.object({
  itemType: z.enum(["product", "material"]),
  name: z.string().trim().min(1, "Name is required"),
  category: nullableText,
  description: nullableText,
  unitDefinitionId: z.string().uuid("Unit is required"),
  defaultSupplierId: z.string().uuid().nullable().optional(),
  purchaseUnitDefinitionId: z.string().uuid().nullable().optional(),
  purchaseToStockFactor: positiveOptionalDecimalString("Purchase-to-stock factor"),
  sku: nullableText,
  sellable: z.boolean().optional(),
  defaultSellingPrice: optionalMoneyString("Default selling price"),
  defaultPurchasePrice: optionalMoneyString("Default purchase price"),
  currentStockUnitCost: optionalNonNegativeDecimalString("Current stock unit cost"),
  registeredBarcode: nullableText,
  internalBarcode: nullableText,
  supplierItemCode: nullableText,
  defaultLeadTimeDays: z.number().int().nonnegative().nullable().optional(),
  minimumOrderQuantity: positiveOptionalDecimalString("Minimum order quantity"),
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
});

export const itemCardUpdateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").optional(),
  category: patchNullableText,
  description: patchNullableText,
  unitDefinitionId: z.string().uuid("Unit is required").optional(),
  defaultSupplierId: z.string().uuid().nullable().optional(),
  purchaseUnitDefinitionId: z.string().uuid().nullable().optional(),
  purchaseToStockFactor: patchPositiveOptionalDecimalString("Purchase-to-stock factor"),
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
});

/**
 * Variant-level field PATCH for the card UI. Updates fields that live on
 * `inventory.items` for a single focused variant (not the family). All fields
 * are optional — only those present are applied, matching the inline-cell
 * autosave pattern used by the card's variant table.
 */
export const itemCardVariantUpdateSchema = z.object({
  sku: patchNullableText,
  registeredBarcode: patchNullableText,
  internalBarcode: patchNullableText,
  supplierItemCode: patchNullableText,
  defaultLeadTimeDays: z.number().int().nonnegative().nullable().optional(),
  minimumOrderQuantity: patchPositiveOptionalDecimalString("Minimum order quantity"),
  defaultSellingPrice: z
    .string()
    .nullable()
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      return value != null ? value.trim() || null : null;
    })
    .refine(
      (value) => value == null || (Number.isFinite(Number(value)) && Number(value) >= 0),
      "Default selling price must be a non-negative number",
    ),
  defaultPurchasePrice: z
    .string()
    .nullable()
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      return value != null ? value.trim() || null : null;
    })
    .refine(
      (value) => value == null || (Number.isFinite(Number(value)) && Number(value) >= 0),
      "Default purchase price must be a non-negative number",
    ),
  currentStockUnitCost: z
    .string()
    .nullable()
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      return value != null ? value.trim() || null : null;
    })
    .refine(
      (value) => value == null || (Number.isFinite(Number(value)) && Number(value) >= 0),
      "Current stock unit cost must be a non-negative number",
    ),
  safetyStock: z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      return value.trim() || "0";
    })
    .refine(
      (value) => value == null || (Number.isFinite(Number(value)) && Number(value) >= 0),
      "Safety stock must be a non-negative number",
    ),
  sellable: z.boolean().optional(),
  optionValueIdsByOptionId: z
    .record(z.string().uuid(), z.string().uuid())
    .optional(),
});

export const generateVariantsSchema = z.object({
  combinations: z
    .array(z.record(z.string().uuid(), z.string().uuid()))
    .optional(),
});

export type VariantOptionValueDto = {
  id: string;
  label: string;
  code: string;
  sortOrder: number;
  disabledAt: Date | null;
};

export type VariantOptionDto = {
  id: string;
  name: string;
  code: string;
  sortOrder: number;
  disabledAt: Date | null;
  values: VariantOptionValueDto[];
};

export type ItemCardVariantDto = {
  id: string;
  familyId: string;
  name: string;
  displayName: string;
  sku: string | null;
  itemType: ItemType;
  optionCombinationKey: string;
  optionValues: VariantOptionValueDisplay[];
  duplicateCombinationWarnings: DuplicateCombinationWarning[];
  deletedAt: Date | null;
  registeredBarcode: string | null;
  internalBarcode: string | null;
  supplierItemCode: string | null;
  defaultLeadTimeDays: number | null;
  minimumOrderQuantity: string | null;
};

export type ItemCardDto = {
  focusedVariantId: string;
  family: {
    id: string;
    itemType: ItemType;
    name: string;
    category: string | null;
    description: string | null;
    unitDefinitionId: string;
    unitName: string | null;
    defaultSupplierId: string | null;
    purchaseUnitDefinitionId: string | null;
    purchaseToStockFactor: string | null;
    deletedAt: Date | null;
  };
  options: VariantOptionDto[];
  variants: ItemCardVariantDto[];
};

export type GenerationPreviewDto = {
  familyId: string;
  potentialCount: number;
  existingCount: number;
  missingCount: number;
  warnOver100: boolean;
  blocksGenerateAll: boolean;
  missingCombinations: Array<{
    optionValueIdsByOptionId: Record<string, string>;
    optionCombinationKey: string;
    displayName: string;
  }>;
};

function stableCode(prefix: string, value: string) {
  return `${prefix}_${value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "value"}`;
}

function uniqueCode(baseCode: string, usedCodes: Set<string>) {
  let code = baseCode;
  let suffix = 2;
  while (usedCodes.has(code)) {
    const suffixText = `_${suffix}`;
    code = `${baseCode.slice(0, Math.max(1, 100 - suffixText.length))}${suffixText}`;
    suffix += 1;
  }
  usedCodes.add(code);
  return code;
}

function buildCombinationKey(
  parts: Array<{ optionCode: string; optionSortOrder: number; valueCode: string }>,
) {
  return [...parts]
    .sort(
      (left, right) =>
        left.optionSortOrder - right.optionSortOrder ||
        left.optionCode.localeCompare(right.optionCode),
    )
    .map((part) => `${part.optionCode}=${part.valueCode}`)
    .join("|");
}

function combinationSelectionKey(optionValueIdsByOptionId: Record<string, string>) {
  return Object.entries(optionValueIdsByOptionId)
    .sort(([leftOptionId], [rightOptionId]) => leftOptionId.localeCompare(rightOptionId))
    .map(([optionId, valueId]) => `${optionId}=${valueId}`)
    .join("|");
}

function displayName(familyName: string, optionValues: VariantOptionValueDisplay[]) {
  if (optionValues.length === 0) return familyName;
  return `${familyName} / ${optionValues.map((value) => value.valueLabel).join(" / ")}`;
}

function duplicateWarnings(variants: Array<{ id: string; optionCombinationKey: string }>) {
  const byKey = new Map<string, string[]>();
  for (const variant of variants) {
    if (!variant.optionCombinationKey) continue;
    byKey.set(variant.optionCombinationKey, [
      ...(byKey.get(variant.optionCombinationKey) ?? []),
      variant.id,
    ]);
  }

  const warnings = new Map<string, DuplicateCombinationWarning[]>();
  for (const [optionCombinationKey, ids] of byKey) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      warnings.set(id, [
        ...(warnings.get(id) ?? []),
        {
          variantId: id,
          duplicateOfVariantIds: ids.filter((otherId) => otherId !== id),
          optionCombinationKey,
          message: "Another variant uses the same option values.",
        },
      ]);
    }
  }
  return warnings;
}

async function resolveFamilyIdInTx(tx: Tx, itemId: string) {
  const [row] = await tx
    .select({ familyId: items.familyId })
    .from(items)
    .where(and(eq(items.id, itemId), isNull(items.deletedAt)));

  if (!row?.familyId) {
    throw new ItemCardError("Item card not found", 404);
  }

  return row.familyId;
}

async function optionValuesForItemsInTx(tx: Tx, itemIds: string[]) {
  if (itemIds.length === 0) return new Map<string, VariantOptionValueDisplay[]>();

  const rows = await tx
    .select({
      itemId: itemVariantValues.itemId,
      optionId: variantOptions.id,
      optionName: variantOptions.name,
      optionCode: variantOptions.code,
      valueId: variantOptionValues.id,
      valueLabel: variantOptionValues.label,
      valueCode: variantOptionValues.code,
      optionDisabledAt: variantOptions.disabledAt,
      valueDisabledAt: variantOptionValues.disabledAt,
    })
    .from(itemVariantValues)
    .innerJoin(variantOptions, eq(itemVariantValues.optionId, variantOptions.id))
    .innerJoin(
      variantOptionValues,
      eq(itemVariantValues.optionValueId, variantOptionValues.id),
    )
    .where(inArray(itemVariantValues.itemId, itemIds))
    .orderBy(asc(variantOptions.sortOrder), asc(variantOptionValues.sortOrder));

  const byItem = new Map<string, VariantOptionValueDisplay[]>();
  for (const row of rows) {
    const values = byItem.get(row.itemId) ?? [];
    values.push({
      optionId: row.optionId,
      optionName: row.optionName,
      optionCode: row.optionCode,
      valueId: row.valueId,
      valueLabel: row.valueLabel,
      valueCode: row.valueCode,
      optionDisabledAt: row.optionDisabledAt,
      valueDisabledAt: row.valueDisabledAt,
    });
    byItem.set(row.itemId, values);
  }
  return byItem;
}

async function getItemCardInTx(tx: Tx, itemId: string): Promise<ItemCardDto> {
    const familyId = await resolveFamilyIdInTx(tx, itemId);

    const [family] = await tx
      .select({
        id: itemFamilies.id,
        itemType: itemFamilies.itemType,
        name: itemFamilies.name,
        category: itemFamilies.category,
        description: itemFamilies.description,
        unitDefinitionId: itemFamilies.unitDefinitionId,
        unitName: unitDefinitions.name,
        defaultSupplierId: itemFamilies.defaultSupplierId,
        purchaseUnitDefinitionId: itemFamilies.purchaseUnitDefinitionId,
        purchaseToStockFactor: trimScaleNullable(itemFamilies.purchaseToStockFactor).as(
          "purchaseToStockFactor",
        ),
        deletedAt: itemFamilies.deletedAt,
      })
      .from(itemFamilies)
      .leftJoin(unitDefinitions, eq(itemFamilies.unitDefinitionId, unitDefinitions.id))
      .where(eq(itemFamilies.id, familyId));

    if (!family) throw new ItemCardError("Item card not found", 404);

    const optionRows = await tx
        .select({
          id: variantOptions.id,
          name: variantOptions.name,
          code: variantOptions.code,
          sortOrder: variantOptions.sortOrder,
          disabledAt: variantOptions.disabledAt,
        })
        .from(variantOptions)
        .where(eq(variantOptions.familyId, familyId))
        .orderBy(asc(variantOptions.sortOrder), asc(variantOptions.name));
    const valueRows = await tx
        .select({
          id: variantOptionValues.id,
          optionId: variantOptionValues.optionId,
          label: variantOptionValues.label,
          code: variantOptionValues.code,
          sortOrder: variantOptionValues.sortOrder,
          disabledAt: variantOptionValues.disabledAt,
        })
        .from(variantOptionValues)
        .innerJoin(variantOptions, eq(variantOptionValues.optionId, variantOptions.id))
        .where(eq(variantOptions.familyId, familyId))
        .orderBy(asc(variantOptionValues.sortOrder), asc(variantOptionValues.label));
    const variantRows = await tx
        .select({
          id: items.id,
          familyId: items.familyId,
          name: items.name,
          sku: items.sku,
          itemType: items.itemType,
          optionCombinationKey: items.optionCombinationKey,
          deletedAt: items.deletedAt,
          registeredBarcode: items.registeredBarcode,
          internalBarcode: items.internalBarcode,
          supplierItemCode: items.supplierItemCode,
          defaultLeadTimeDays: items.defaultLeadTimeDays,
          minimumOrderQuantity: trimScaleNullable(items.minimumOrderQuantity).as(
            "minimumOrderQuantity",
          ),
        })
        .from(items)
        .where(eq(items.familyId, familyId))
        .orderBy(asc(items.createdAt), asc(items.id));

    const valuesByOption = new Map<string, VariantOptionValueDto[]>();
    for (const row of valueRows) {
      valuesByOption.set(row.optionId, [
        ...(valuesByOption.get(row.optionId) ?? []),
        {
          id: row.id,
          label: row.label,
          code: row.code,
          sortOrder: row.sortOrder,
          disabledAt: row.disabledAt,
        },
      ]);
    }

    const options = optionRows.map((row) => ({
      ...row,
      values: valuesByOption.get(row.id) ?? [],
    }));
    const optionValuesByItem = await optionValuesForItemsInTx(
      tx,
      variantRows.map((row) => row.id),
    );
    const warningsByVariant = duplicateWarnings(variantRows);

    return {
      focusedVariantId: itemId,
      family: {
        ...family,
        itemType: family.itemType as ItemType,
        unitName: family.unitName ?? null,
      },
      options,
      variants: variantRows.map((row) => {
        const optionValues = optionValuesByItem.get(row.id) ?? [];
        return {
          ...row,
          familyId: row.familyId!,
          itemType: row.itemType as ItemType,
          displayName: `${displayName(family.name, optionValues)}${row.deletedAt ? " (deleted)" : ""}`,
          optionValues,
          duplicateCombinationWarnings: warningsByVariant.get(row.id) ?? [],
        };
      }),
    };
}

export async function getItemCard(itemId: string): Promise<ItemCardDto> {
  return withAuthedOrgContext((tx) => getItemCardInTx(tx, itemId));
}

export async function createItemCard(
  data: z.infer<typeof itemCardCreateSchema>,
  options?: { idempotencyKey?: string | null },
) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const replay = await beginInventoryOperationInTx<{
      itemId: string;
      card: ItemCardDto;
    }>(tx, {
      organizationId: orgId,
      operationName: "createItemCard",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { data },
    });
    if (replay.replayed) return replay.result;

    const [family] = await tx
      .insert(itemFamilies)
      .values({
        organizationId: orgId,
        itemType: data.itemType,
        name: data.name,
        category: data.category ?? null,
        description: data.description ?? null,
        unitDefinitionId: data.unitDefinitionId,
        defaultSupplierId:
          data.itemType === "material" ? data.defaultSupplierId ?? null : null,
        purchaseUnitDefinitionId:
          data.itemType === "material" ? data.purchaseUnitDefinitionId ?? null : null,
        purchaseToStockFactor:
          data.itemType === "material" ? data.purchaseToStockFactor ?? null : null,
      })
      .returning({ id: itemFamilies.id });

    const [item] = await tx
      .insert(items)
      .values({
        organizationId: orgId,
        familyId: family.id,
        optionCombinationKey: "",
        itemType: data.itemType,
        name: data.name,
        category: data.category ?? null,
        description: data.description ?? null,
        unitDefinitionId: data.unitDefinitionId,
        purchaseUnitDefinitionId:
          data.itemType === "material" ? data.purchaseUnitDefinitionId ?? null : null,
        purchaseToStockFactor:
          data.itemType === "material" ? data.purchaseToStockFactor ?? null : null,
        sku: data.sku ?? null,
        sellable: data.itemType === "product" ? data.sellable ?? false : false,
        defaultSellingPrice: data.defaultSellingPrice ?? null,
        defaultPurchasePrice: data.defaultPurchasePrice ?? null,
        currentStockUnitCost: data.currentStockUnitCost ?? null,
        safetyStock: "0",
        registeredBarcode: data.registeredBarcode ?? null,
        internalBarcode: data.internalBarcode ?? null,
        supplierItemCode: data.supplierItemCode ?? null,
        defaultLeadTimeDays: data.defaultLeadTimeDays ?? null,
        minimumOrderQuantity: data.minimumOrderQuantity ?? null,
      })
      .returning({ id: items.id });

    const result = {
      itemId: item.id,
      card: await getItemCardInTx(tx, item.id),
    };

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });
    return result;
  });
}

export async function updateItemCard(
  itemId: string,
  data: z.infer<typeof itemCardUpdateSchema>,
  options?: { idempotencyKey?: string | null },
) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const replay = await beginInventoryOperationInTx<{ id: string }>(tx, {
      organizationId: orgId,
      operationName: "updateItemCard",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { itemId, data },
    });
    if (replay.replayed) return replay.result;

    const familyId = await resolveFamilyIdInTx(tx, itemId);
    const [family] = await tx
      .select({ itemType: itemFamilies.itemType })
      .from(itemFamilies)
      .where(eq(itemFamilies.id, familyId))
      .for("update");

    if (!family) throw new ItemCardError("Item card not found", 404);
    if (
      family.itemType !== "material" &&
      (data.defaultSupplierId !== undefined ||
        data.purchaseUnitDefinitionId !== undefined ||
        data.purchaseToStockFactor !== undefined)
    ) {
      throw new ItemCardError("Purchase defaults are only supported for material cards.");
    }

    await tx
      .update(itemFamilies)
      .set({
        name: data.name,
        category: data.category,
        description: data.description,
        unitDefinitionId: data.unitDefinitionId,
        defaultSupplierId:
          family.itemType === "material" ? data.defaultSupplierId : undefined,
        purchaseUnitDefinitionId:
          family.itemType === "material" ? data.purchaseUnitDefinitionId : undefined,
        purchaseToStockFactor:
          family.itemType === "material" ? data.purchaseToStockFactor : undefined,
        updatedAt: new Date(),
      })
      .where(eq(itemFamilies.id, familyId));

    // Mirror card-level fields to every variant on the family so list pages,
    // inventory queries, and downstream sales/MO/PO references keep showing
    // the latest name/category/description/unit.
    await tx
      .update(items)
      .set({
        name: data.name,
        category: data.category,
        description: data.description,
        unitDefinitionId: data.unitDefinitionId,
        purchaseUnitDefinitionId:
          family.itemType === "material" ? data.purchaseUnitDefinitionId : undefined,
        purchaseToStockFactor:
          family.itemType === "material" ? data.purchaseToStockFactor : undefined,
        updatedAt: new Date(),
      })
      .where(eq(items.familyId, familyId));

    const result = { id: itemId };
    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });
    return result;
  });
}

/**
 * Update variant-level fields for a single items row. Used by the card UI's
 * inline-cell autosave (SKU, barcodes, supplier item code, lead time, MOQ,
 * pricing). Does not touch `item_families`.
 */
export async function updateItemCardVariant(
  itemId: string,
  data: z.infer<typeof itemCardVariantUpdateSchema>,
  options?: { idempotencyKey?: string | null },
) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const replay = await beginInventoryOperationInTx<{ id: string }>(tx, {
      organizationId: orgId,
      operationName: "updateItemCardVariant",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { itemId, data },
    });
    if (replay.replayed) return replay.result;

    const [variant] = await tx
      .select({ id: items.id, familyId: items.familyId })
      .from(items)
      .where(and(eq(items.id, itemId), isNull(items.deletedAt)))
      .for("update");
    if (!variant?.familyId) {
      throw new ItemCardError("Item card variant not found", 404);
    }
    const now = new Date();

    await tx
      .update(items)
      .set({
        sku: data.sku,
        registeredBarcode: data.registeredBarcode,
        internalBarcode: data.internalBarcode,
        supplierItemCode: data.supplierItemCode,
        defaultLeadTimeDays: data.defaultLeadTimeDays,
        minimumOrderQuantity: data.minimumOrderQuantity,
        defaultSellingPrice: data.defaultSellingPrice,
        defaultPurchasePrice: data.defaultPurchasePrice,
        currentStockUnitCost: data.currentStockUnitCost,
        safetyStock: data.safetyStock,
        sellable: data.sellable,
        updatedAt: now,
      })
      .where(eq(items.id, itemId));

    if (data.optionValueIdsByOptionId !== undefined) {
      const activeOptions = await tx
        .select({
          id: variantOptions.id,
          name: variantOptions.name,
        })
        .from(variantOptions)
        .where(
          and(
            eq(variantOptions.familyId, variant.familyId),
            isNull(variantOptions.disabledAt),
          ),
        )
        .orderBy(asc(variantOptions.sortOrder), asc(variantOptions.name));

      if (activeOptions.length === 0) {
        throw new ItemCardError("This item card has no active variant options");
      }

      const activeOptionIds = new Set(activeOptions.map((option) => option.id));
      const submittedEntries = Object.entries(data.optionValueIdsByOptionId);
      if (
        submittedEntries.length !== activeOptions.length ||
        submittedEntries.some(([optionId]) => !activeOptionIds.has(optionId))
      ) {
        throw new ItemCardError("Select one value for every active variant option");
      }

      const selectedValueIds = submittedEntries.map(([, valueId]) => valueId);
      const selectedValues = await tx
        .select({
          id: variantOptionValues.id,
          optionId: variantOptionValues.optionId,
        })
        .from(variantOptionValues)
        .innerJoin(variantOptions, eq(variantOptionValues.optionId, variantOptions.id))
        .where(
          and(
            eq(variantOptions.familyId, variant.familyId),
            isNull(variantOptionValues.disabledAt),
            inArray(variantOptionValues.id, selectedValueIds),
          ),
        );
      const selectedValueByOption = new Map(
        selectedValues.map((value) => [value.optionId, value.id]),
      );

      for (const [optionId, valueId] of submittedEntries) {
        if (selectedValueByOption.get(optionId) !== valueId) {
          throw new ItemCardError("Variant option value is not valid for this card");
        }
      }

      await tx.delete(itemVariantValues).where(eq(itemVariantValues.itemId, itemId));
      await tx.insert(itemVariantValues).values(
        submittedEntries.map(([optionId, optionValueId]) => ({
          organizationId: orgId,
          itemId,
          optionId,
          optionValueId,
          updatedAt: now,
        })),
      );
      await recomputeVariantKeysInTx(tx, variant.familyId);
    }

    const result = { id: itemId };
    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });
    return result;
  });
}

async function recomputeVariantKeysInTx(tx: Tx, familyId: string) {
  const assignmentRows = await tx
    .select({
      itemId: itemVariantValues.itemId,
      optionCode: variantOptions.code,
      optionSortOrder: variantOptions.sortOrder,
      valueCode: variantOptionValues.code,
    })
    .from(itemVariantValues)
    .innerJoin(variantOptions, eq(itemVariantValues.optionId, variantOptions.id))
    .innerJoin(variantOptionValues, eq(itemVariantValues.optionValueId, variantOptionValues.id))
    .where(eq(variantOptions.familyId, familyId))
    .orderBy(asc(variantOptions.sortOrder), asc(variantOptions.code));

  const partsByItem = new Map<
    string,
    Array<{ optionCode: string; optionSortOrder: number; valueCode: string }>
  >();
  for (const row of assignmentRows) {
    partsByItem.set(row.itemId, [...(partsByItem.get(row.itemId) ?? []), row]);
  }

  for (const [variantId, parts] of partsByItem) {
    await tx
      .update(items)
      .set({
        optionCombinationKey: buildCombinationKey(parts),
        updatedAt: new Date(),
      })
      .where(eq(items.id, variantId));
  }
}

export async function updateVariantConfig(
  itemId: string,
  data: z.infer<typeof variantConfigSchema>,
  options?: { idempotencyKey?: string | null },
) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const replay = await beginInventoryOperationInTx<ItemCardDto>(tx, {
      organizationId: orgId,
      operationName: "updateItemCardVariantConfig",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { itemId, data },
    });
    if (replay.replayed) return replay.result;

    const familyId = await resolveFamilyIdInTx(tx, itemId);
    await tx
      .select({ id: itemFamilies.id })
      .from(itemFamilies)
      .where(eq(itemFamilies.id, familyId))
      .for("update");
    const now = new Date();
    const existingOptions = await tx
      .select({
        id: variantOptions.id,
        code: variantOptions.code,
        sortOrder: variantOptions.sortOrder,
      })
      .from(variantOptions)
      .where(eq(variantOptions.familyId, familyId));
    const keptOptionIds = new Set(data.options.flatMap((option) => (option.id ? [option.id] : [])));
    const optionUsedRows = await tx
      .select({ optionId: itemVariantValues.optionId })
      .from(itemVariantValues)
      .innerJoin(variantOptions, eq(itemVariantValues.optionId, variantOptions.id))
      .where(eq(variantOptions.familyId, familyId));
    const usedOptionIds = new Set(optionUsedRows.map((row) => row.optionId));
    const submittedOptionCodes = new Map<number, string>();
    const usedOptionCodes = new Set(
      existingOptions
        .filter((option) => keptOptionIds.has(option.id))
        .map((option) => option.code),
    );
    data.options.forEach((option, index) => {
      if (option.id) return;
      submittedOptionCodes.set(
        index,
        uniqueCode(option.code ?? stableCode("opt", option.name), usedOptionCodes),
      );
    });

    for (const existingOption of existingOptions) {
      if (keptOptionIds.has(existingOption.id)) continue;
      if (usedOptionIds.has(existingOption.id)) {
        await tx
          .update(variantOptions)
          .set({
            disabledAt: now,
            sortOrder: existingOption.sortOrder + 1000,
            updatedAt: now,
          })
          .where(eq(variantOptions.id, existingOption.id));
      } else {
        await tx.delete(variantOptions).where(eq(variantOptions.id, existingOption.id));
      }
    }

    for (let optionIndex = 0; optionIndex < data.options.length; optionIndex++) {
      const option = data.options[optionIndex];
      const existingOption = option.id
        ? existingOptions.find((row) => row.id === option.id)
        : null;
      const optionSortOrder = option.sortOrder ?? optionIndex;
      const [upsertedOption] = existingOption
        ? await tx
            .update(variantOptions)
            .set({
              name: option.name,
              code: usedOptionIds.has(existingOption.id)
                ? existingOption.code
                : option.code
                  ? uniqueCode(
                      option.code,
                      new Set(
                        [...usedOptionCodes].filter((code) => code !== existingOption.code),
                      ),
                    )
                  : existingOption.code,
              sortOrder: optionSortOrder,
              disabledAt: null,
              updatedAt: now,
            })
            .where(and(eq(variantOptions.id, existingOption.id), eq(variantOptions.familyId, familyId)))
            .returning({ id: variantOptions.id, code: variantOptions.code })
        : await tx
            .insert(variantOptions)
            .values({
              organizationId: orgId,
              familyId,
              name: option.name,
              code:
                submittedOptionCodes.get(optionIndex) ??
                uniqueCode(option.code ?? stableCode("opt", option.name), usedOptionCodes),
              sortOrder: optionSortOrder,
            })
            .returning({ id: variantOptions.id, code: variantOptions.code });

      const existingValues = await tx
        .select({
          id: variantOptionValues.id,
          code: variantOptionValues.code,
          sortOrder: variantOptionValues.sortOrder,
        })
        .from(variantOptionValues)
        .where(eq(variantOptionValues.optionId, upsertedOption.id));
      const keptValueIds = new Set(option.values.flatMap((value) => (value.id ? [value.id] : [])));
      const valueUsedRows = await tx
        .select({ optionValueId: itemVariantValues.optionValueId })
        .from(itemVariantValues)
        .where(eq(itemVariantValues.optionId, upsertedOption.id));
      const usedValueIds = new Set(valueUsedRows.map((row) => row.optionValueId));
      const submittedValueCodes = new Map<number, string>();
      const usedValueCodes = new Set(
        existingValues
          .filter((value) => keptValueIds.has(value.id))
          .map((value) => value.code),
      );
      option.values.forEach((value, index) => {
        if (value.id) return;
        submittedValueCodes.set(
          index,
          uniqueCode(value.code ?? stableCode("val", value.label), usedValueCodes),
        );
      });

      for (const existingValue of existingValues) {
        if (keptValueIds.has(existingValue.id)) continue;
        if (usedValueIds.has(existingValue.id)) {
          await tx
            .update(variantOptionValues)
            .set({
              disabledAt: now,
              sortOrder: existingValue.sortOrder + 1000,
              updatedAt: now,
            })
            .where(eq(variantOptionValues.id, existingValue.id));
        } else {
          await tx
            .delete(variantOptionValues)
            .where(eq(variantOptionValues.id, existingValue.id));
        }
      }

      for (let valueIndex = 0; valueIndex < option.values.length; valueIndex++) {
        const value = option.values[valueIndex];
        const existingValue = value.id
          ? existingValues.find((row) => row.id === value.id)
          : null;
        if (existingValue) {
          await tx
            .update(variantOptionValues)
            .set({
              label: value.label,
              code: usedValueIds.has(existingValue.id)
                ? existingValue.code
                : value.code
                  ? uniqueCode(
                      value.code,
                      new Set(
                        [...usedValueCodes].filter((code) => code !== existingValue.code),
                      ),
                    )
                  : existingValue.code,
              sortOrder: value.sortOrder ?? valueIndex,
              disabledAt: null,
              updatedAt: now,
            })
            .where(eq(variantOptionValues.id, existingValue.id));
        } else {
          await tx.insert(variantOptionValues).values({
            organizationId: orgId,
            optionId: upsertedOption.id,
            label: value.label,
            code:
              submittedValueCodes.get(valueIndex) ??
              uniqueCode(value.code ?? stableCode("val", value.label), usedValueCodes),
            sortOrder: value.sortOrder ?? valueIndex,
          });
        }
      }

    }

    await recomputeVariantKeysInTx(tx, familyId);
    const result = await getItemCardInTx(tx, itemId);
    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });
    return result;
  });
}

async function generationPreviewInTx(tx: Tx, itemId: string): Promise<GenerationPreviewDto> {
  const familyId = await resolveFamilyIdInTx(tx, itemId);
  const card = await getItemCardInTx(tx, itemId);
  const activeOptions = card.options.filter((option) => option.disabledAt == null);
  const valueSets = activeOptions.map((option) =>
    option.values
      .filter((value) => value.disabledAt == null)
      .map((value) => ({ option, value })),
  );

  const combinations = valueSets.reduce<Array<Array<{ option: VariantOptionDto; value: VariantOptionValueDto }>>>(
    (acc, set) => acc.flatMap((combo) => set.map((value) => [...combo, value])),
    [[]],
  );
  const existingKeys = new Set(card.variants.map((variant) => variant.optionCombinationKey));
  const missingCombinations = combinations
    .map((combo) => {
      const optionCombinationKey = buildCombinationKey(
        combo.map(({ option, value }) => ({
          optionCode: option.code,
          optionSortOrder: option.sortOrder,
          valueCode: value.code,
        })),
      );
      return {
        optionValueIdsByOptionId: Object.fromEntries(
          combo.map(({ option, value }) => [option.id, value.id]),
        ),
        optionCombinationKey,
        displayName: `${card.family.name} / ${combo.map(({ value }) => value.label).join(" / ")}`,
      };
    })
    .filter((combo) => !existingKeys.has(combo.optionCombinationKey));

  return {
    familyId,
    potentialCount: combinations.length,
    existingCount: card.variants.length,
    missingCount: missingCombinations.length,
    warnOver100: missingCombinations.length > 100,
    blocksGenerateAll: missingCombinations.length > 250,
    missingCombinations,
  };
}

export async function generateVariantPreview(itemId: string) {
  return withAuthedOrgContext((tx) => generationPreviewInTx(tx, itemId));
}

export async function generateVariants(
  itemId: string,
  data: z.infer<typeof generateVariantsSchema>,
  options?: { idempotencyKey?: string | null },
) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const familyId = await resolveFamilyIdInTx(tx, itemId);
    const replay = await beginInventoryOperationInTx<{ created: Array<{ id: string }> }>(tx, {
      organizationId: orgId,
      operationName: "generateItemCardVariants",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { itemId, data },
    });
    if (replay.replayed) return replay.result;

    await tx
      .select({ id: itemFamilies.id })
      .from(itemFamilies)
      .where(eq(itemFamilies.id, familyId))
      .for("update");

    const preview = await generationPreviewInTx(tx, itemId);
    const selected = data.combinations
      ? preview.missingCombinations.filter((combo) => {
          const selectedKeys = new Set(
            data.combinations?.map(combinationSelectionKey) ?? [],
          );
          return selectedKeys.has(combinationSelectionKey(combo.optionValueIdsByOptionId));
        })
      : preview.missingCombinations;

    if (data.combinations == null && preview.blocksGenerateAll) {
      throw new ItemCardError("Generate all is limited to 250 missing combinations.");
    }

    const [source] = await tx
      .select()
      .from(items)
      .where(and(eq(items.id, itemId), isNull(items.deletedAt)))
      .for("update");
    if (!source?.familyId) throw new ItemCardError("Item card not found", 404);

    const optionRows = await tx
      .select({
        optionId: variantOptions.id,
        optionCode: variantOptions.code,
        optionSortOrder: variantOptions.sortOrder,
        valueId: variantOptionValues.id,
        valueCode: variantOptionValues.code,
      })
      .from(variantOptions)
      .innerJoin(variantOptionValues, eq(variantOptionValues.optionId, variantOptions.id))
      .where(eq(variantOptions.familyId, source.familyId));
    const valueById = new Map(optionRows.map((row) => [row.valueId, row]));

    const created: Array<{ id: string }> = [];
    const bareDefaultVariant =
      source.optionCombinationKey === ""
        ? await tx
            .select({ itemId: itemVariantValues.itemId })
            .from(itemVariantValues)
            .where(eq(itemVariantValues.itemId, source.id))
            .limit(1)
        : [];
    const [promotedCombo, ...remainingCombos] =
      bareDefaultVariant.length === 0 && selected.length > 0 ? selected : [undefined, ...selected];

    if (promotedCombo) {
      await tx.insert(itemVariantValues).values(
        Object.entries(promotedCombo.optionValueIdsByOptionId).map(([optionId, valueId]) => {
          const value = valueById.get(valueId);
          if (!value || value.optionId !== optionId) {
            throw new ItemCardError("Invalid variant combination.");
          }
          return {
            organizationId: orgId,
            itemId: source.id,
            optionId,
            optionValueId: valueId,
          };
        }),
      );
      await tx
        .update(items)
        .set({
          optionCombinationKey: promotedCombo.optionCombinationKey,
          updatedAt: new Date(),
        })
        .where(eq(items.id, source.id));
    }

    for (const combo of remainingCombos) {
      if (!combo) continue;
      const [variant] = await tx
        .insert(items)
        .values({
          organizationId: orgId,
          familyId: source.familyId,
          optionCombinationKey: combo.optionCombinationKey,
          name: source.name,
          description: source.description,
          sku: null,
          category: source.category,
          itemType: source.itemType,
          unitDefinitionId: source.unitDefinitionId,
          purchaseUnitDefinitionId: source.purchaseUnitDefinitionId,
          purchaseToStockFactor: source.purchaseToStockFactor,
          safetyStock: source.safetyStock,
          defaultPurchasePrice: source.defaultPurchasePrice,
          currentStockUnitCost: source.currentStockUnitCost,
          defaultSellingPrice: source.defaultSellingPrice,
          sellable: source.sellable,
          manufacturingMode: source.manufacturingMode,
          expectedBatchYield: source.expectedBatchYield,
          typicalBatchSize: source.typicalBatchSize,
          typicalGroupSize: source.typicalGroupSize,
          registeredBarcode: null,
          internalBarcode: null,
          supplierItemCode: null,
          defaultLeadTimeDays: source.defaultLeadTimeDays,
          minimumOrderQuantity: source.minimumOrderQuantity,
        })
        .returning({ id: items.id });
      created.push(variant);

      await tx.insert(itemVariantValues).values(
        Object.entries(combo.optionValueIdsByOptionId).map(([optionId, valueId]) => {
          const value = valueById.get(valueId);
          if (!value || value.optionId !== optionId) {
            throw new ItemCardError("Invalid variant combination.");
          }
          return {
            organizationId: orgId,
            itemId: variant.id,
            optionId,
            optionValueId: valueId,
          };
        }),
      );
    }

    const result = { created };
    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });
    return result;
  });
}

async function getBlockingReferenceMessageInTx(tx: Tx, variantIds: string[]) {
  if (variantIds.length === 0) return null;

  const [stockRef] = await tx
    .select({ itemId: inventoryItemBalances.itemId })
    .from(inventoryItemBalances)
    .where(
      and(
        inArray(inventoryItemBalances.itemId, variantIds),
        sql`${inventoryItemBalances.onHandQty} <> 0`,
      ),
    )
    .limit(1);
  if (stockRef) return "Cannot delete while a variant has stock.";

  const [bomRef] = await tx
    .select({ id: bomRevisionComponents.id })
    .from(bomRevisionComponents)
    .innerJoin(bomRevisions, eq(bomRevisionComponents.bomRevisionId, bomRevisions.id))
    .innerJoin(items, eq(bomRevisions.productId, items.id))
    .where(
      and(
        inArray(bomRevisionComponents.componentId, variantIds),
        eq(bomRevisions.isCurrent, true),
        isNull(items.deletedAt),
      ),
    )
    .limit(1);
  if (bomRef) return "Cannot delete: a variant is used as a BOM component.";

  const [activeOrderRef] = await tx
    .select({ id: salesOrderLines.id })
    .from(salesOrderLines)
    .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
    .where(
      and(
        inArray(salesOrderLines.itemId, variantIds),
        isNull(salesOrders.deletedAt),
        inArray(salesOrders.status, ["open", "draft", "confirmed", "partially_shipped"]),
      ),
    )
    .limit(1);
  if (activeOrderRef) return "Cannot delete: a variant is used by an active sales order.";

  const [activeManufacturingRef] = await tx
    .select({ id: manufacturingOrders.id })
    .from(manufacturingOrders)
    .leftJoin(
      manufacturingOrderIngredients,
      eq(manufacturingOrderIngredients.manufacturingOrderId, manufacturingOrders.id),
    )
    .where(
      and(
        isNull(manufacturingOrders.deletedAt),
        inArray(manufacturingOrders.status, ["open", "draft", "released"]),
        or(
          inArray(manufacturingOrders.productId, variantIds),
          inArray(manufacturingOrderIngredients.itemId, variantIds),
        ),
      ),
    )
    .limit(1);
  if (activeManufacturingRef) {
    return "Cannot delete: a variant is used by an open manufacturing order.";
  }

  const [activePurchasingRef] = await tx
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .innerJoin(purchaseOrderLines, eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id))
    .where(
      and(
        inArray(purchaseOrderLines.itemId, variantIds),
        isNull(purchaseOrders.deletedAt),
        inArray(purchaseOrders.status, ["draft", "ordered", "partial"]),
      ),
    )
    .limit(1);
  if (activePurchasingRef) {
    return "Cannot delete: a variant is used by an active purchase order.";
  }

  const [draftStocktakeRef] = await tx
    .select({ id: stocktakes.id })
    .from(stocktakes)
    .innerJoin(stocktakeItems, eq(stocktakeItems.stocktakeId, stocktakes.id))
    .where(and(inArray(stocktakeItems.itemId, variantIds), eq(stocktakes.status, "draft")))
    .limit(1);
  if (draftStocktakeRef) return "Cannot delete: a variant is used by a draft stocktake.";

  return null;
}

async function hasHistoricalReferenceInTx(tx: Tx, variantIds: string[]) {
  if (variantIds.length === 0) return false;

  const checks = await Promise.all([
    tx.select({ id: inventoryEvents.id }).from(inventoryEvents).where(inArray(inventoryEvents.itemId, variantIds)).limit(1),
    tx.select({ id: lots.id }).from(lots).where(inArray(lots.itemId, variantIds)).limit(1),
    tx.select({ id: salesOrderLines.id }).from(salesOrderLines).where(inArray(salesOrderLines.itemId, variantIds)).limit(1),
    tx.select({ id: purchaseOrderLines.id }).from(purchaseOrderLines).where(inArray(purchaseOrderLines.itemId, variantIds)).limit(1),
    tx.select({ id: manufacturingOrders.id }).from(manufacturingOrders).where(inArray(manufacturingOrders.productId, variantIds)).limit(1),
    tx.select({ id: manufacturingOrderIngredients.id }).from(manufacturingOrderIngredients).where(inArray(manufacturingOrderIngredients.itemId, variantIds)).limit(1),
    tx.select({ id: bomRevisions.id }).from(bomRevisions).where(inArray(bomRevisions.productId, variantIds)).limit(1),
    tx.select({ id: bomRevisionComponents.id }).from(bomRevisionComponents).where(inArray(bomRevisionComponents.componentId, variantIds)).limit(1),
    tx.select({ id: stocktakeItems.id }).from(stocktakeItems).where(inArray(stocktakeItems.itemId, variantIds)).limit(1),
    tx.select({ id: supplierItems.id }).from(supplierItems).where(inArray(supplierItems.itemId, variantIds)).limit(1),
    tx.select({ id: stockAllocations.id }).from(stockAllocations).where(inArray(stockAllocations.itemId, variantIds)).limit(1),
  ]);

  return checks.some((rows) => rows.length > 0);
}

export async function deleteVariant(
  variantId: string,
  options?: { idempotencyKey?: string | null },
) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const replay = await beginInventoryOperationInTx<{
      deleted: boolean;
      hardDeleted: boolean;
    }>(tx, {
      organizationId: orgId,
      operationName: "deleteItemCardVariant",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { variantId },
    });
    if (replay.replayed) return replay.result;

    const [variant] = await tx
      .select({ id: items.id, familyId: items.familyId })
      .from(items)
      .where(and(eq(items.id, variantId), isNull(items.deletedAt)))
      .for("update");

    if (!variant?.familyId) throw new ItemCardError("Variant not found", 404);

    const activeSiblings = await tx
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.familyId, variant.familyId), isNull(items.deletedAt)))
      .for("update");
    if (activeSiblings.length <= 1) {
      throw new ItemCardError("Cannot delete the last variant. Delete the item card instead.");
    }

    const blocker = await getBlockingReferenceMessageInTx(tx, [variant.id]);
    if (blocker) throw new ItemCardError(blocker);

    if (await hasHistoricalReferenceInTx(tx, [variant.id])) {
      await tx
        .update(items)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(items.id, variant.id));
      const result = { deleted: true, hardDeleted: false };
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result,
      });
      return result;
    }

    await tx.delete(itemVariantValues).where(eq(itemVariantValues.itemId, variant.id));
    await tx.delete(items).where(eq(items.id, variant.id));
    const result = { deleted: true, hardDeleted: true };
    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });
    return result;
  });
}

export async function deleteItemCard(
  itemId: string,
  options?: { idempotencyKey?: string | null },
) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const replay = await beginInventoryOperationInTx<{
      deleted: boolean;
      hardDeleted?: boolean;
    }>(tx, {
      organizationId: orgId,
      operationName: "deleteItemCard",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { itemId },
    });
    if (replay.replayed) return replay.result;

    const familyId = await resolveFamilyIdInTx(tx, itemId);
    const variantRows = await tx
      .select({ id: items.id })
      .from(items)
      .where(eq(items.familyId, familyId))
      .for("update");

    const variantIds = variantRows.map((row) => row.id);
    if (variantIds.length === 0) {
      const result = { deleted: false };
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result,
      });
      return result;
    }

    const blocker = await getBlockingReferenceMessageInTx(tx, variantIds);
    if (blocker) throw new ItemCardError(blocker);

    if (!(await hasHistoricalReferenceInTx(tx, variantIds))) {
      await tx.delete(itemVariantValues).where(inArray(itemVariantValues.itemId, variantIds));
      await tx
        .delete(variantOptionValues)
        .where(
          inArray(
            variantOptionValues.optionId,
            tx
              .select({ id: variantOptions.id })
              .from(variantOptions)
              .where(eq(variantOptions.familyId, familyId)),
          ),
        );
      await tx.delete(variantOptions).where(eq(variantOptions.familyId, familyId));
      await tx.delete(items).where(eq(items.familyId, familyId));
      await tx.delete(itemFamilies).where(eq(itemFamilies.id, familyId));
      const result = { deleted: true, hardDeleted: true };
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result,
      });
      return result;
    }

    await tx
      .update(items)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(items.familyId, familyId), isNull(items.deletedAt)));
    await tx
      .update(itemFamilies)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(itemFamilies.id, familyId));

    const result = { deleted: true, hardDeleted: false };
    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });
    return result;
  });
}
