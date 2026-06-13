import "server-only";

import { cache } from "react";
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  itemFamilies,
  itemVariantValues,
  items,
  inventoryItemBalances,
  inventoryEvents,
  inventoryLotBalances,
  bomRevisionComponents,
  bomRevisionComponentConstraints,
  bomRevisions,
  lots,
  manufacturingPickAllocations,
  manufacturingOrderIngredients,
  manufacturingOrderOutputs,
  manufacturingOrders,
  purchaseOrderLines,
  purchaseOrders,
  salesOrderLines,
  salesOrders,
  stocktakeItems,
  stocktakeLotItems,
  stocktakes,
  supplierItems,
  unitDefinitions,
  variantOptionValues,
  variantOptions,
} from "@/lib/db/schema";
import { trimScaleNullable } from "@/lib/db/numeric";
import {
  itemCardCreateSchema,
  itemCardDocUpdateSchema,
  itemCardUpdateSchema,
  itemCardVariantCreateSchema,
  itemCardVariantUpdateSchema,
} from "@/lib/schemas/item-cards";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import { DomainError } from "@/lib/errors/domain-error";
import {
  beginInventoryOperationInTx,
  finishInventoryOperationInTx,
} from "@/lib/inventory/kernel";
import { projectedOnHandQty } from "@/lib/inventory/kernel/read";
import { getEstimatedRecipeCostSummariesByItemIdInTx } from "@/lib/inventory/estimated-cost";
import {
  LOT_TRACKING_MODES,
  type LotTrackingMode,
} from "@/lib/inventory/lot-tracking";
import {
  consolidateUntrackedFamilyLotsInTx,
  convertUntrackedFamilyLotsToTrackedInTx,
} from "@/lib/inventory/untracked-lot-consolidation";
import {
  createBomRevisionInTx,
  type BomInputRow,
  type BomOperationCostInputRow,
} from "@/lib/inventory/queries/bom-write";
import { getMinimumLotAgeDays } from "@/lib/bom/constraints";
import {
  getCurrentBomComponentsInTx,
  getCurrentBomRevisionInTx,
} from "@/lib/bom/revisions";
import { getCurrentBomOperationCostsInTx } from "@/lib/bom/operation-costs";
import type {
  DuplicateCombinationWarning,
  ItemType,
  VariantOptionValueDisplay,
} from "@/lib/inventory/types";

export class ItemCardError extends DomainError {
  constructor(message: string, status = 400) {
    super(message, status, { name: "ItemCardError" });
  }
}

const CLONE_NAME_PREFIX = "Copy of ";
const ITEM_NAME_MAX_LENGTH = 255;

function cloneName(name: string) {
  const maxSourceLength = ITEM_NAME_MAX_LENGTH - CLONE_NAME_PREFIX.length;
  return `${CLONE_NAME_PREFIX}${name.slice(0, maxSourceLength).trimEnd()}`;
}

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

export const copyVariantConfigSchema = z.object({
  sourceItemId: z.string().uuid(),
});

export {
  itemCardCreateSchema,
  itemCardDocUpdateSchema,
  itemCardUpdateSchema,
  itemCardVariantCreateSchema,
  itemCardVariantUpdateSchema,
} from "@/lib/schemas/item-cards";

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
  defaultSellingPrice: string | null;
  defaultPurchasePrice: string | null;
  inStockQty: string;
  ingredientsCost: string | null;
  operationsCost: string | null;
  sortOrder: number;
  sellable: boolean;
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
    lotTrackingMode: LotTrackingMode;
    version: number;
    deletedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
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

function activeOptionValues(optionValues: VariantOptionValueDisplay[]) {
  return optionValues.filter(
    (value) => value.optionDisabledAt == null && value.valueDisabledAt == null,
  );
}

function displayName(familyName: string, optionValues: VariantOptionValueDisplay[]) {
  const activeValues = activeOptionValues(optionValues);
  if (activeValues.length === 0) return familyName;
  return `${familyName} / ${activeValues.map((value) => value.valueLabel).join(" / ")}`;
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

async function getVariantCostSummariesInTx(
  tx: Tx,
  variants: Array<{
    id: string;
  }>,
) {
  const variantIds = variants.map((variant) => variant.id);
  const empty = new Map<string, { ingredientsCost: string | null; operationsCost: string | null }>();
  if (variantIds.length === 0) return empty;

  const summaries = await getEstimatedRecipeCostSummariesByItemIdInTx(tx, variantIds);
  return new Map(
    variantIds.map((id) => {
      const summary = summaries.get(id);
      return [
        id,
        {
          ingredientsCost: summary?.ingredientsCost ?? null,
          operationsCost: summary?.operationsCost ?? null,
        },
      ];
    })
  );
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
        lotTrackingMode: itemFamilies.lotTrackingMode,
        version: itemFamilies.version,
        deletedAt: itemFamilies.deletedAt,
        createdAt: itemFamilies.createdAt,
        updatedAt: itemFamilies.updatedAt,
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
          defaultSellingPrice: trimScaleNullable(items.defaultSellingPrice).as(
            "defaultSellingPrice",
          ),
          defaultPurchasePrice: trimScaleNullable(items.defaultPurchasePrice).as(
            "defaultPurchasePrice",
          ),
          inStockQty: projectedOnHandQty(items.organizationId, items.id).as("inStockQty"),
          sortOrder: items.sortOrder,
          sellable: items.sellable,
          expectedBatchYield: trimScaleNullable(items.expectedBatchYield).as(
            "expectedBatchYield",
          ),
          typicalBatchSize: trimScaleNullable(items.typicalBatchSize).as(
            "typicalBatchSize",
          ),
          standardCostQuantity: trimScaleNullable(items.standardCostQuantity).as(
            "standardCostQuantity",
          ),
        })
        .from(items)
        .where(eq(items.familyId, familyId))
        .orderBy(asc(items.sortOrder), asc(items.createdAt), asc(items.id));

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
    const costSummariesByVariant = await getVariantCostSummariesInTx(tx, variantRows);

    return {
      focusedVariantId: itemId,
      family: {
        ...family,
        itemType: family.itemType as ItemType,
        lotTrackingMode: family.lotTrackingMode as LotTrackingMode,
        unitName: family.unitName ?? null,
      },
      options,
      variants: variantRows.map((row) => {
        const optionValues = optionValuesByItem.get(row.id) ?? [];
        return {
          ...row,
          familyId: row.familyId!,
          sellable: row.sellable ?? false,
          itemType: row.itemType as ItemType,
          displayName: `${displayName(family.name, optionValues)}${row.deletedAt ? " (deleted)" : ""}`,
          optionValues,
          duplicateCombinationWarnings: warningsByVariant.get(row.id) ?? [],
          ingredientsCost: costSummariesByVariant.get(row.id)?.ingredientsCost ?? null,
          operationsCost: costSummariesByVariant.get(row.id)?.operationsCost ?? null,
        };
      }),
    };
}

async function assertCanDisableLotTrackingInTx(tx: Tx, familyId: string) {
  const variantRows = await tx
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.familyId, familyId), isNull(items.deletedAt)))
    .for("update");
  const itemIds = variantRows.map((row) => row.id);

  if (itemIds.length === 0) return;

  const [draftStocktakeLot] = await tx
    .select({ id: stocktakeLotItems.id })
    .from(stocktakeLotItems)
    .innerJoin(stocktakeItems, eq(stocktakeLotItems.stocktakeItemId, stocktakeItems.id))
    .innerJoin(stocktakes, eq(stocktakeItems.stocktakeId, stocktakes.id))
    .where(and(inArray(stocktakeItems.itemId, itemIds), eq(stocktakes.status, "draft")))
    .limit(1);
  if (draftStocktakeLot) {
    throw new ItemCardError(
      "Lot tracking cannot be turned off while draft stocktake lot counts exist.",
      409
    );
  }

  const [nonAvailableBalance] = await tx
    .select({ lotId: inventoryLotBalances.lotId })
    .from(inventoryLotBalances)
    .where(
      and(
        inArray(inventoryLotBalances.itemId, itemIds),
        sql`${inventoryLotBalances.disposition} <> 'available'`,
        sql`${inventoryLotBalances.quantity} <> 0`
      )
    )
    .limit(1);
  if (nonAvailableBalance) {
    throw new ItemCardError(
      "Lot tracking cannot be turned off while blocked or rejected stock exists.",
      409
    );
  }

  const [negativeAvailableBalance] = await tx
    .select({ lotId: inventoryLotBalances.lotId })
    .from(inventoryLotBalances)
    .where(
      and(
        inArray(inventoryLotBalances.itemId, itemIds),
        eq(inventoryLotBalances.disposition, "available"),
        sql`${inventoryLotBalances.quantity} < 0`
      )
    )
    .limit(1);
  if (negativeAvailableBalance) {
    throw new ItemCardError(
      "Lot tracking cannot be turned off while tracked lots have negative stock.",
      409
    );
  }

  const [openPickAllocation] = await tx
    .select({ id: manufacturingPickAllocations.id })
    .from(manufacturingPickAllocations)
    .innerJoin(
      manufacturingOrderIngredients,
      eq(
        manufacturingPickAllocations.manufacturingOrderIngredientId,
        manufacturingOrderIngredients.id
      )
    )
    .innerJoin(
      manufacturingOrders,
      eq(manufacturingOrderIngredients.manufacturingOrderId, manufacturingOrders.id)
    )
    .where(
      and(
        inArray(manufacturingOrderIngredients.itemId, itemIds),
        eq(manufacturingOrders.status, "open"),
        isNull(manufacturingOrders.deletedAt)
      )
    )
    .limit(1);
  if (openPickAllocation) {
    throw new ItemCardError(
      "Lot tracking cannot be turned off while open manufacturing picks reference lots.",
      409
    );
  }

  const [openOutput] = await tx
    .select({ id: manufacturingOrderOutputs.id })
    .from(manufacturingOrderOutputs)
    .innerJoin(
      manufacturingOrders,
      eq(manufacturingOrderOutputs.manufacturingOrderId, manufacturingOrders.id)
    )
    .where(
      and(
        inArray(manufacturingOrders.productId, itemIds),
        eq(manufacturingOrders.status, "open"),
        isNull(manufacturingOrders.deletedAt)
      )
    )
    .limit(1);
  if (openOutput) {
    throw new ItemCardError(
      "Lot tracking cannot be turned off while open manufacturing outputs reference lots.",
      409
    );
  }

  const [lotAgeConstraint] = await tx
    .select({ id: bomRevisionComponentConstraints.id })
    .from(bomRevisionComponentConstraints)
    .innerJoin(
      bomRevisionComponents,
      eq(
        bomRevisionComponentConstraints.bomRevisionComponentId,
        bomRevisionComponents.id
      )
    )
    .where(
      and(
        inArray(bomRevisionComponents.componentId, itemIds),
        eq(bomRevisionComponentConstraints.constraintType, "lot_age_min_days")
      )
    )
    .limit(1);
  if (lotAgeConstraint) {
    throw new ItemCardError(
      "Lot tracking cannot be turned off while recipes require minimum lot age.",
      409
    );
  }
}

async function assertCanEnableLotTrackingInTx(tx: Tx, familyId: string) {
  const variantRows = await tx
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.familyId, familyId), isNull(items.deletedAt)))
    .for("update");
  const itemIds = variantRows.map((row) => row.id);

  if (itemIds.length === 0) return;

  const [draftStocktakeLot] = await tx
    .select({ id: stocktakeLotItems.id })
    .from(stocktakeLotItems)
    .innerJoin(stocktakeItems, eq(stocktakeLotItems.stocktakeItemId, stocktakeItems.id))
    .innerJoin(stocktakes, eq(stocktakeItems.stocktakeId, stocktakes.id))
    .where(and(inArray(stocktakeItems.itemId, itemIds), eq(stocktakes.status, "draft")))
    .limit(1);
  if (draftStocktakeLot) {
    throw new ItemCardError(
      "Lot tracking cannot be turned on while draft stocktake lot counts exist.",
      409
    );
  }

  const [openPickAllocation] = await tx
    .select({ id: manufacturingPickAllocations.id })
    .from(manufacturingPickAllocations)
    .innerJoin(
      manufacturingOrderIngredients,
      eq(
        manufacturingPickAllocations.manufacturingOrderIngredientId,
        manufacturingOrderIngredients.id
      )
    )
    .innerJoin(
      manufacturingOrders,
      eq(manufacturingOrderIngredients.manufacturingOrderId, manufacturingOrders.id)
    )
    .where(
      and(
        inArray(manufacturingOrderIngredients.itemId, itemIds),
        eq(manufacturingOrders.status, "open"),
        isNull(manufacturingOrders.deletedAt)
      )
    )
    .limit(1);
  if (openPickAllocation) {
    throw new ItemCardError(
      "Lot tracking cannot be turned on while open manufacturing picks reference lots.",
      409
    );
  }

  const [openOutput] = await tx
    .select({ id: manufacturingOrderOutputs.id })
    .from(manufacturingOrderOutputs)
    .innerJoin(
      manufacturingOrders,
      eq(manufacturingOrderOutputs.manufacturingOrderId, manufacturingOrders.id)
    )
    .where(
      and(
        inArray(manufacturingOrders.productId, itemIds),
        eq(manufacturingOrders.status, "open"),
        isNull(manufacturingOrders.deletedAt)
      )
    )
    .limit(1);
  if (openOutput) {
    throw new ItemCardError(
      "Lot tracking cannot be turned on while open manufacturing outputs reference lots.",
      409
    );
  }
}

export const getItemCard = cache(async (itemId: string): Promise<ItemCardDto> => {
  return withAuthedOrgContext((tx) => getItemCardInTx(tx, itemId));
});

export async function cloneItemCard(
  sourceItemId: string,
  options?: { idempotencyKey?: string | null },
) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{
      itemId: string;
      card: ItemCardDto;
    }>(tx, {
      organizationId: orgId,
      operationName: "cloneItemCard",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { sourceItemId },
    });
    if (replay.replayed) return replay.result;

    const sourceFamilyId = await resolveFamilyIdInTx(tx, sourceItemId);
    const [sourceFamily] = await tx
      .select()
      .from(itemFamilies)
      .where(and(eq(itemFamilies.id, sourceFamilyId), isNull(itemFamilies.deletedAt)))
      .for("update");
    if (!sourceFamily) throw new ItemCardError("Item card not found", 404);

    const sourceVariants = await tx
      .select()
      .from(items)
      .where(and(eq(items.familyId, sourceFamilyId), isNull(items.deletedAt)))
      .orderBy(asc(items.sortOrder), asc(items.createdAt), asc(items.id))
      .for("update");
    if (sourceVariants.length === 0) {
      throw new ItemCardError("Item card has no active variants to clone.", 409);
    }

    const [clonedFamily] = await tx
      .insert(itemFamilies)
      .values({
        organizationId: orgId,
        itemType: sourceFamily.itemType,
        name: cloneName(sourceFamily.name),
        category: sourceFamily.category,
        description: sourceFamily.description,
        unitDefinitionId: sourceFamily.unitDefinitionId,
        defaultSupplierId: sourceFamily.defaultSupplierId,
        purchaseUnitDefinitionId: sourceFamily.purchaseUnitDefinitionId,
        purchaseToStockFactor: sourceFamily.purchaseToStockFactor,
        lotTrackingMode: sourceFamily.lotTrackingMode,
      })
      .returning({ id: itemFamilies.id });

    const clonedVariantIdsBySourceId = new Map<string, string>();
    for (const source of sourceVariants) {
      const [clonedVariant] = await tx
        .insert(items)
        .values({
          organizationId: orgId,
          familyId: clonedFamily.id,
          optionCombinationKey: source.optionCombinationKey,
          name: cloneName(source.name),
          description: source.description,
          sku: null,
          category: source.category,
          itemType: source.itemType,
          unitDefinitionId: source.unitDefinitionId,
          purchaseUnitDefinitionId: source.purchaseUnitDefinitionId,
          purchaseToStockFactor: source.purchaseToStockFactor,
          safetyStock: source.safetyStock,
          defaultPurchasePrice: source.defaultPurchasePrice,
          currentStockUnitCost: null,
          defaultSellingPrice: source.defaultSellingPrice,
          sellable: source.sellable,
          manufacturingMode: source.manufacturingMode,
          expectedBatchYield: source.expectedBatchYield,
          typicalBatchSize: source.typicalBatchSize,
          standardCostQuantity: source.standardCostQuantity,
          supplierItemCode: source.supplierItemCode,
          defaultLeadTimeDays: source.defaultLeadTimeDays,
          minimumOrderQuantity: source.minimumOrderQuantity,
          sortOrder: source.sortOrder,
          registeredBarcode: null,
          internalBarcode: null,
        })
        .returning({ id: items.id });
      clonedVariantIdsBySourceId.set(source.id, clonedVariant.id);
    }

    const sourceOptions = await tx
      .select()
      .from(variantOptions)
      .where(eq(variantOptions.familyId, sourceFamilyId))
      .orderBy(asc(variantOptions.sortOrder), asc(variantOptions.name));
    const clonedOptionIdsBySourceId = new Map<string, string>();
    for (const sourceOption of sourceOptions) {
      const [clonedOption] = await tx
        .insert(variantOptions)
        .values({
          organizationId: orgId,
          familyId: clonedFamily.id,
          name: sourceOption.name,
          code: sourceOption.code,
          sortOrder: sourceOption.sortOrder,
          disabledAt: sourceOption.disabledAt,
        })
        .returning({ id: variantOptions.id });
      clonedOptionIdsBySourceId.set(sourceOption.id, clonedOption.id);
    }

    if (sourceOptions.length > 0) {
      const sourceOptionIds = sourceOptions.map((option) => option.id);
      const sourceValues = await tx
        .select()
        .from(variantOptionValues)
        .where(inArray(variantOptionValues.optionId, sourceOptionIds))
        .orderBy(asc(variantOptionValues.sortOrder), asc(variantOptionValues.label));
      const clonedValueIdsBySourceId = new Map<string, string>();
      for (const sourceValue of sourceValues) {
        const clonedOptionId = clonedOptionIdsBySourceId.get(sourceValue.optionId);
        if (!clonedOptionId) continue;

        const [clonedValue] = await tx
          .insert(variantOptionValues)
          .values({
            organizationId: orgId,
            optionId: clonedOptionId,
            label: sourceValue.label,
            code: sourceValue.code,
            sortOrder: sourceValue.sortOrder,
            disabledAt: sourceValue.disabledAt,
          })
          .returning({ id: variantOptionValues.id });
        clonedValueIdsBySourceId.set(sourceValue.id, clonedValue.id);
      }

      const sourceVariantIds = sourceVariants.map((variant) => variant.id);
      const sourceAssignments = await tx
        .select()
        .from(itemVariantValues)
        .where(inArray(itemVariantValues.itemId, sourceVariantIds));
      const clonedAssignments = sourceAssignments.flatMap((assignment) => {
        const clonedItemId = clonedVariantIdsBySourceId.get(assignment.itemId);
        const clonedOptionId = clonedOptionIdsBySourceId.get(assignment.optionId);
        const clonedValueId = clonedValueIdsBySourceId.get(assignment.optionValueId);
        if (!clonedItemId || !clonedOptionId || !clonedValueId) return [];

        return [
          {
            organizationId: orgId,
            itemId: clonedItemId,
            optionId: clonedOptionId,
            optionValueId: clonedValueId,
          },
        ];
      });
      if (clonedAssignments.length > 0) {
        await tx.insert(itemVariantValues).values(clonedAssignments);
      }
    }

    if (sourceFamily.itemType === "product") {
      for (const source of sourceVariants) {
        const clonedProductId = clonedVariantIdsBySourceId.get(source.id);
        if (!clonedProductId) continue;

        const sourceRevision = await getCurrentBomRevisionInTx(tx, source.id);
        if (!sourceRevision) continue;

        const sourceBom = await getCurrentBomComponentsInTx(tx, source.id);
        const sourceOperationCosts = await getCurrentBomOperationCostsInTx(tx, source.id);
        const bom: BomInputRow[] = sourceBom.map((row) => ({
          componentId: clonedVariantIdsBySourceId.get(row.componentId) ?? row.componentId,
          quantity: row.quantity,
          minimumLotAgeDays: getMinimumLotAgeDays(row.constraints),
          alternates: row.alternates.map((alternate) => ({
            itemId:
              clonedVariantIdsBySourceId.get(alternate.alternateItemId) ??
              alternate.alternateItemId,
          })),
        }));
        const operationCosts: BomOperationCostInputRow[] = sourceOperationCosts.map(
          (row) => ({
            operationName: row.operationName,
            resourceId: row.resourceId,
            costScalingMode: "per_output_unit",
            crewSize: row.crewSize,
            plannedMinutes: row.plannedMinutes,
            loadedCostPerHour: row.loadedCostPerHour,
          }),
        );

        await createBomRevisionInTx(tx, {
          orgId,
          userId,
          productId: clonedProductId,
          note: sourceRevision.note ?? `Copied from ${source.id}`,
          outputQuantity: sourceRevision.outputQuantity,
          recipeBasis: sourceRevision.recipeBasis === "batch" ? "batch" : "unit",
          bom,
          operationCosts,
        });
      }
    }

    const itemId =
      clonedVariantIdsBySourceId.get(sourceItemId) ??
      clonedVariantIdsBySourceId.get(sourceVariants[0].id);
    if (!itemId) throw new ItemCardError("Failed to clone item card.", 500);

    const result = {
      itemId,
      card: await getItemCardInTx(tx, itemId),
    };
    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });
    return result;
  });
}

/** Distinct category labels already used by item families of the given type. */
export const getItemFamilyCategories = cache(
  async (itemType: ItemType): Promise<string[]> => {
    return withAuthedOrgContext(async (tx) => {
      const rows = await tx
        .selectDistinct({ category: itemFamilies.category })
        .from(itemFamilies)
        .where(
          and(
            eq(itemFamilies.itemType, itemType),
            isNotNull(itemFamilies.category),
            isNull(itemFamilies.deletedAt),
          ),
        )
        .orderBy(asc(itemFamilies.category));
      // isNotNull in the WHERE clause guarantees no nulls.
      return rows.map((row) => row.category as string);
    });
  },
);

export async function createItemCard(
  data: z.infer<typeof itemCardCreateSchema>,
  options?: { idempotencyKey?: string | null },
) {
  return withAuthedOrgContext(async (tx, orgId) => {
    return createItemCardInTx(tx, orgId, data, options);
  });
}

export async function createItemCardInTx(
  tx: Tx,
  orgId: string,
  data: z.infer<typeof itemCardCreateSchema>,
  options?: { idempotencyKey?: string | null },
) {
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
      lotTrackingMode: data.lotTrackingMode ?? "tracked",
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
}

export async function updateItemCardInTx(
  tx: Tx,
  orgId: string,
  userId: string,
  itemId: string,
  data: z.infer<typeof itemCardUpdateSchema>,
  options?: { idempotencyKey?: string | null },
) {
  const replay = await beginInventoryOperationInTx<ItemCardDto>(tx, {
    organizationId: orgId,
    operationName: "updateItemCard",
    idempotencyKey: options?.idempotencyKey ?? null,
    payload: { itemId, data },
  });
  if (replay.replayed) return replay.result;

  const familyId = await resolveFamilyIdInTx(tx, itemId);
  const [family] = await tx
    .select({
      itemType: itemFamilies.itemType,
      lotTrackingMode: itemFamilies.lotTrackingMode,
    })
    .from(itemFamilies)
    .where(eq(itemFamilies.id, familyId))
    .for("update");

  if (!family) throw new ItemCardError("Item card not found", 404);
  if (
    data.lotTrackingMode === "untracked" &&
    family.lotTrackingMode !== "untracked"
  ) {
    await assertCanDisableLotTrackingInTx(tx, familyId);
  }
  if (
    family.itemType !== "material" &&
    (data.defaultSupplierId !== undefined ||
      data.purchaseUnitDefinitionId !== undefined ||
      data.purchaseToStockFactor !== undefined)
  ) {
    throw new ItemCardError("Purchase defaults are only supported for material cards.");
  }

  if (
    data.lotTrackingMode === "untracked" &&
    family.lotTrackingMode !== "untracked"
  ) {
    await consolidateUntrackedFamilyLotsInTx(tx, {
      organizationId: orgId,
      familyId,
      actorUserId: userId,
    });
  }
  if (
    data.lotTrackingMode === "tracked" &&
    family.lotTrackingMode === "untracked"
  ) {
    await assertCanEnableLotTrackingInTx(tx, familyId);
    await convertUntrackedFamilyLotsToTrackedInTx(tx, {
      organizationId: orgId,
      familyId,
    });
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
      lotTrackingMode: data.lotTrackingMode,
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

  const result = await getItemCardInTx(tx, itemId);
  await finishInventoryOperationInTx(tx, {
    organizationId: orgId,
    idempotencyKey: options?.idempotencyKey ?? null,
    result,
  });
  return result;
}

/**
 * Update variant-level fields for a single items row. Used by the card UI's
 * inline-cell autosave (SKU, barcodes, supplier item code, lead time, MOQ,
 * pricing). Does not touch `item_families`.
 */
export async function updateItemCardVariantInTx(
  tx: Tx,
  orgId: string,
  itemId: string,
  data: z.infer<typeof itemCardVariantUpdateSchema>,
  options?: { idempotencyKey?: string | null },
) {
  const replay = await beginInventoryOperationInTx<ItemCardDto>(tx, {
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
        optionCode: variantOptions.code,
        optionSortOrder: variantOptions.sortOrder,
        valueCode: variantOptionValues.code,
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

  const result = await getItemCardInTx(tx, itemId);
  await finishInventoryOperationInTx(tx, {
    organizationId: orgId,
    idempotencyKey: options?.idempotencyKey ?? null,
    result,
  });
  return result;
}

export async function createItemCardVariant(
  sourceItemId: string,
  data: z.infer<typeof itemCardVariantCreateSchema>,
  options?: { idempotencyKey?: string | null },
) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const replay = await beginInventoryOperationInTx<{
      itemId: string;
      card: ItemCardDto;
    }>(tx, {
      organizationId: orgId,
      operationName: "createItemCardVariant",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { sourceItemId, data },
    });
    if (replay.replayed) return replay.result;

    const [source] = await tx
      .select()
      .from(items)
      .where(and(eq(items.id, sourceItemId), isNull(items.deletedAt)))
      .for("update");
    if (!source?.familyId) throw new ItemCardError("Item card not found", 404);

    await tx
      .select({ id: itemFamilies.id })
      .from(itemFamilies)
      .where(and(eq(itemFamilies.id, source.familyId), isNull(itemFamilies.deletedAt)))
      .for("update");

    const activeOptions = await tx
      .select({
        id: variantOptions.id,
        name: variantOptions.name,
      })
      .from(variantOptions)
      .where(
        and(
          eq(variantOptions.familyId, source.familyId),
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
        optionCode: variantOptions.code,
        optionSortOrder: variantOptions.sortOrder,
        valueCode: variantOptionValues.code,
      })
      .from(variantOptionValues)
      .innerJoin(variantOptions, eq(variantOptionValues.optionId, variantOptions.id))
      .where(
        and(
          eq(variantOptions.familyId, source.familyId),
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
    const selectedParts = selectedValues.map((value) => ({
      optionCode: value.optionCode,
      optionSortOrder: value.optionSortOrder,
      valueCode: value.valueCode,
    }));

    const [maxSortOrderRow] = await tx
      .select({ value: sql<number>`COALESCE(MAX(${items.sortOrder}), -1)::int` })
      .from(items)
      .where(eq(items.familyId, source.familyId));
    const now = new Date();
    const [variant] = await tx
      .insert(items)
      .values({
        organizationId: orgId,
        familyId: source.familyId,
        optionCombinationKey: buildCombinationKey(selectedParts),
        name: source.name,
        description: source.description,
        sku: data.sku ?? null,
        category: source.category,
        itemType: source.itemType,
        unitDefinitionId: source.unitDefinitionId,
        purchaseUnitDefinitionId: source.purchaseUnitDefinitionId,
        purchaseToStockFactor: source.purchaseToStockFactor,
        safetyStock: data.safetyStock ?? source.safetyStock,
        defaultPurchasePrice: data.defaultPurchasePrice ?? source.defaultPurchasePrice,
        currentStockUnitCost: data.currentStockUnitCost ?? source.currentStockUnitCost,
        defaultSellingPrice: data.defaultSellingPrice ?? source.defaultSellingPrice,
        sellable: data.sellable ?? source.sellable,
        manufacturingMode: source.manufacturingMode,
        expectedBatchYield: source.expectedBatchYield,
        typicalBatchSize: source.typicalBatchSize,
        standardCostQuantity: source.standardCostQuantity,
        supplierItemCode: data.supplierItemCode ?? null,
        defaultLeadTimeDays: data.defaultLeadTimeDays ?? source.defaultLeadTimeDays,
        minimumOrderQuantity: data.minimumOrderQuantity ?? source.minimumOrderQuantity,
        sortOrder: Number(maxSortOrderRow?.value ?? -1) + 1,
        registeredBarcode: data.registeredBarcode ?? null,
        internalBarcode: data.internalBarcode ?? null,
        updatedAt: now,
      })
      .returning({ id: items.id });

    await tx.insert(itemVariantValues).values(
      submittedEntries.map(([optionId, optionValueId]) => ({
        organizationId: orgId,
        itemId: variant.id,
        optionId,
        optionValueId,
        updatedAt: now,
      })),
    );
    await recomputeVariantKeysInTx(tx, source.familyId);
    await bumpItemFamilyVersionInTx(tx, source.familyId);

    const result = {
      itemId: variant.id,
      card: await getItemCardInTx(tx, variant.id),
    };
    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });
    return result;
  });
}

async function applyVariantOrderInTx(
  tx: Tx,
  familyId: string,
  orderedVariantIds: string[],
) {
  const uniqueIds = [...new Set(orderedVariantIds)];
  if (uniqueIds.length !== orderedVariantIds.length) {
    throw new ItemCardError("Variant order cannot include duplicates");
  }

  const currentVariants = await tx
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.familyId, familyId), isNull(items.deletedAt)))
    .orderBy(asc(items.id))
    .for("update");
  const currentIds = currentVariants.map((variant) => variant.id);
  if (
    uniqueIds.length !== currentIds.length ||
    uniqueIds.some((variantId) => !currentIds.includes(variantId))
  ) {
    throw new ItemCardError("Variant order must include every visible variant on this card");
  }

  for (const [sortOrder, variantId] of uniqueIds.entries()) {
    await tx
      .update(items)
      .set({ sortOrder, updatedAt: new Date() })
      .where(eq(items.id, variantId));
  }
}

async function bumpItemFamilyVersionInTx(tx: Tx, familyId: string) {
  await tx
    .update(itemFamilies)
    .set({
      version: sql`${itemFamilies.version} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(itemFamilies.id, familyId));
}

export type ItemCardDocUpdateResult =
  | { kind: "updated"; card: ItemCardDto }
  | { kind: "conflict"; current: ItemCardDto };

/**
 * The consolidated card-document save: family fields, per-variant fields,
 * and variant order apply in one transaction under one idempotency key,
 * guarded by the family row's version when the caller sends expectedVersion.
 */
export async function updateItemCardDoc(
  itemId: string,
  data: z.infer<typeof itemCardDocUpdateSchema>,
  options?: { idempotencyKey?: string | null },
): Promise<ItemCardDocUpdateResult> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<ItemCardDocUpdateResult>(tx, {
      organizationId: orgId,
      operationName: "updateItemCardDoc",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { itemId, data },
    });
    if (replay.replayed) return replay.result;

    const familyId = await resolveFamilyIdInTx(tx, itemId);
    const { expectedVersion, family, variants, variantOrder } = data;

    const [bumped] = await tx
      .update(itemFamilies)
      .set({
        version: sql`${itemFamilies.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(itemFamilies.id, familyId),
          ...(expectedVersion != null
            ? [eq(itemFamilies.version, expectedVersion)]
            : []),
        ),
      )
      .returning({ id: itemFamilies.id });

    if (!bumped) {
      const result: ItemCardDocUpdateResult = {
        kind: "conflict",
        current: await getItemCardInTx(tx, itemId),
      };
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result,
      });
      return result;
    }

    if (family) {
      await updateItemCardInTx(tx, orgId, userId, itemId, family);
    }
    for (const { id: variantId, ...patch } of variants ?? []) {
      await updateItemCardVariantInTx(tx, orgId, variantId, patch);
    }
    if (variantOrder) {
      await applyVariantOrderInTx(tx, familyId, variantOrder);
    }

    const result: ItemCardDocUpdateResult = {
      kind: "updated",
      card: await getItemCardInTx(tx, itemId),
    };
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
    const activeVariantRows = await tx
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.familyId, familyId), isNull(items.deletedAt)))
      .for("update");
    if (activeVariantRows.length > 1 && data.options.length === 0) {
      const variantIdsToDelete = activeVariantRows
        .map((variant) => variant.id)
        .filter((variantId) => variantId !== itemId);
      const blocker = await getBlockingReferenceMessageInTx(tx, variantIdsToDelete);
      if (blocker) throw new ItemCardError(blocker);

      const historicallyReferencedIds: string[] = [];
      const unreferencedIds: string[] = [];
      for (const variantId of variantIdsToDelete) {
        if (await hasHistoricalReferenceInTx(tx, [variantId])) {
          historicallyReferencedIds.push(variantId);
        } else {
          unreferencedIds.push(variantId);
        }
      }
      if (historicallyReferencedIds.length > 0) {
        await tx
          .update(items)
          .set({ deletedAt: now, updatedAt: now })
          .where(inArray(items.id, historicallyReferencedIds));
      }
      if (unreferencedIds.length > 0) {
        await tx.delete(itemVariantValues).where(inArray(itemVariantValues.itemId, unreferencedIds));
        await tx.delete(items).where(inArray(items.id, unreferencedIds));
      }
    }
    if (
      activeVariantRows.length > 1 &&
      data.options.some((option) => option.values.length === 0)
    ) {
      throw new ItemCardError(
        "Each option needs at least one value while this card has multiple variants.",
      );
    }
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

    if (data.options.length === 0) {
      await tx.delete(itemVariantValues).where(eq(itemVariantValues.itemId, itemId));
      await tx
        .update(items)
        .set({ optionCombinationKey: "", updatedAt: now })
        .where(eq(items.id, itemId));
    }

    await recomputeVariantKeysInTx(tx, familyId);
    await bumpItemFamilyVersionInTx(tx, familyId);
    const result = await getItemCardInTx(tx, itemId);
    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });
    return result;
  });
}

export async function copyVariantConfigFromItem(
  targetItemId: string,
  data: z.infer<typeof copyVariantConfigSchema>,
  options?: { idempotencyKey?: string | null },
) {
  const [targetCard, sourceCard] = await Promise.all([
    getItemCard(targetItemId),
    getItemCard(data.sourceItemId),
  ]);

  if (targetCard.family.itemType !== sourceCard.family.itemType) {
    throw new ItemCardError("Variant configuration can only be copied from the same item type.");
  }
  if (targetCard.family.id === sourceCard.family.id) {
    throw new ItemCardError("Choose a different card to copy from.");
  }

  return updateVariantConfig(
    targetItemId,
    {
      options: sourceCard.options
        .filter((option) => option.disabledAt == null)
        .map((option, optionIndex) => ({
          name: option.name,
          code: option.code,
          sortOrder: optionIndex,
          values: option.values
            .filter((value) => value.disabledAt == null)
            .map((value, valueIndex) => ({
              label: value.label,
              code: value.code,
              sortOrder: valueIndex,
            })),
        })),
    },
    options,
  );
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
  const existingKeys = new Set(
    card.variants
      .filter((variant) => variant.deletedAt == null)
      .map((variant) => variant.optionCombinationKey),
  );
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
    existingCount: card.variants.filter((variant) => variant.deletedAt == null).length,
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
    const canPromoteSourceVariant =
      source.optionCombinationKey === "" && bareDefaultVariant.length === 0;
    const [promotedCombo, ...remainingCombos] =
      canPromoteSourceVariant && selected.length > 0 ? selected : [undefined, ...selected];
    const [maxSortOrderRow] = await tx
      .select({ value: sql<number>`COALESCE(MAX(${items.sortOrder}), -1)::int` })
      .from(items)
      .where(eq(items.familyId, source.familyId));
    let nextSortOrder = Number(maxSortOrderRow?.value ?? -1) + 1;

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
          sortOrder: nextSortOrder++,
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

    if (selected.length > 0) {
      await bumpItemFamilyVersionInTx(tx, source.familyId);
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
      await bumpItemFamilyVersionInTx(tx, variant.familyId);
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
    await bumpItemFamilyVersionInTx(tx, variant.familyId);
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
