import { eq, inArray } from "drizzle-orm";
import {
  itemFamilies,
  itemVariantValues,
  items,
  variantOptions,
  variantOptionValues,
} from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { normalizeNumeric } from "@/lib/format";
import {
  buildExistingItemsByName,
  findExistingItem,
  orderSeedsForSync,
  resolveSeedCurrentStockUnitCost,
  resolveSeedSellable,
} from "./seeds";
import { getUnitSignature } from "./org";
import type {
  ExistingItem,
  ExistingUnit,
  ItemSeed,
  Report,
  UnitSeed,
} from "./types";

export { buildExistingItemsByName };

export function assertNoDuplicateSkus(
  rows: ExistingItem[],
  relevantSkus?: Set<string>
) {
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.sku) continue;
    if (relevantSkus && !relevantSkus.has(row.sku)) {
      continue;
    }
    if (seen.has(row.sku)) {
      throw new Error(`Duplicate item SKU found: ${row.sku}`);
    }
    seen.add(row.sku);
  }
}

export async function loadExistingItemsInTx(tx: Tx): Promise<ExistingItem[]> {
  return tx
    .select({
      id: items.id,
      sku: items.sku,
      name: items.name,
      itemType: items.itemType,
      familyId: items.familyId,
      unitDefinitionId: items.unitDefinitionId,
      purchaseUnitDefinitionId: items.purchaseUnitDefinitionId,
      purchaseToStockFactor: items.purchaseToStockFactor,
      category: items.category,
      description: items.description,
      defaultPurchasePrice: items.defaultPurchasePrice,
      currentStockUnitCost: items.currentStockUnitCost,
      defaultSellingPrice: items.defaultSellingPrice,
      manufacturingMode: items.manufacturingMode,
      expectedBatchYield: items.expectedBatchYield,
      typicalBatchSize: items.typicalBatchSize,
      typicalGroupSize: items.typicalGroupSize,
      bomLocked: items.bomLocked,
      safetyStock: items.safetyStock,
      isMaster: items.isMaster,
      parentId: items.parentId,
      variantAxes: items.variantAxes,
      variantAttrs: items.variantAttrs,
      sellable: items.sellable,
      deletedAt: items.deletedAt,
    })
    .from(items);
}

function numericStringEquals(
  existing: string | null | undefined,
  desired: string | null | undefined
) {
  if (existing == null || desired == null) {
    return existing == null && desired == null;
  }

  const existingNumber = Number(existing);
  const desiredNumber = Number(desired);
  if (!Number.isFinite(existingNumber) || !Number.isFinite(desiredNumber)) {
    return existing === desired;
  }

  return normalizeNumeric(existingNumber) === normalizeNumeric(desiredNumber);
}

function stableCode(prefix: string, value: string) {
  return `${prefix}_${value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "value"}`;
}

function optionCombinationKeyForVariant(
  axes: string[],
  valueCodeByAxis: Map<string, Map<string, string>>,
  variantAttrs?: Record<string, string>
) {
  if (!variantAttrs || axes.length === 0) return "";

  return axes
    .map((axis) => {
      const value = variantAttrs[axis];
      const valueCode = value ? valueCodeByAxis.get(axis)?.get(value) : null;
      return `${stableCode("opt", axis)}:${valueCode ?? stableCode("val", value ?? "")}`;
    })
    .join("|");
}

function familyKeyForSeed(seed: ItemSeed) {
  return seed.parentKey ?? seed.key;
}

function isFamilySeed(seed: ItemSeed) {
  return seed.isMaster === true || !seed.parentKey;
}

function childSeedsForFamily(seeds: ItemSeed[], familyKey: string) {
  return seeds.filter((seed) => seed.parentKey === familyKey);
}

function variantSeedsForFamily(seeds: ItemSeed[], familySeed: ItemSeed) {
  return familySeed.isMaster ? childSeedsForFamily(seeds, familySeed.key) : [familySeed];
}

function firstVariantUnitKey(seeds: ItemSeed[], familySeed: ItemSeed) {
  if (familySeed.unitKey) return familySeed.unitKey;

  return variantSeedsForFamily(seeds, familySeed).find((seed) => seed.unitKey)?.unitKey ?? null;
}

function axesForFamily(familySeed: ItemSeed, variantSeeds: ItemSeed[]) {
  if (familySeed.variantAxes?.length) return familySeed.variantAxes;

  const axes: string[] = [];
  for (const seed of variantSeeds) {
    for (const axis of Object.keys(seed.variantAttrs ?? {})) {
      if (!axes.includes(axis)) axes.push(axis);
    }
  }
  return axes;
}

function findExistingForSeed(
  seed: ItemSeed,
  itemBySku: Map<string, ExistingItem>,
  itemByName: Map<string, ExistingItem[]>
) {
  const isMaster = seed.isMaster === true;
  return findExistingItem(seed, itemBySku, itemByName, {
    allowNameMatch: true,
    nameMatchPredicate: isMaster
      ? (item) => item.isMaster === true
      : (item) => item.isMaster !== true,
  });
}

function findExistingFamilyId(
  familySeed: ItemSeed,
  variantSeeds: ItemSeed[],
  itemBySku: Map<string, ExistingItem>,
  itemByName: Map<string, ExistingItem[]>
) {
  const existingFamilySeedItem = findExistingForSeed(familySeed, itemBySku, itemByName);
  if (existingFamilySeedItem?.familyId) return existingFamilySeedItem.familyId;

  for (const variantSeed of variantSeeds) {
    const existingVariant = findExistingForSeed(variantSeed, itemBySku, itemByName);
    if (existingVariant?.familyId) return existingVariant.familyId;
  }

  return null;
}

type FamilyOptionMap = {
  axes: string[];
  optionIdByAxis: Map<string, string>;
  valueIdByAxisAndLabel: Map<string, Map<string, string>>;
  valueCodeByAxisAndLabel: Map<string, Map<string, string>>;
};

async function syncFamilyOptionsInTx(
  tx: Tx,
  orgId: string,
  familyId: string,
  axes: string[],
  variantSeeds: ItemSeed[]
): Promise<FamilyOptionMap> {
  const optionIdByAxis = new Map<string, string>();
  const valueIdByAxisAndLabel = new Map<string, Map<string, string>>();
  const valueCodeByAxisAndLabel = new Map<string, Map<string, string>>();

  if (axes.length === 0) {
    return {
      axes,
      optionIdByAxis,
      valueIdByAxisAndLabel,
      valueCodeByAxisAndLabel,
    };
  }

  const existingOptions = await tx
    .select({
      id: variantOptions.id,
      code: variantOptions.code,
    })
    .from(variantOptions)
    .where(eq(variantOptions.familyId, familyId));
  const existingOptionByCode = new Map(existingOptions.map((option) => [option.code, option]));

  for (const [sortOrder, axis] of axes.entries()) {
    const optionCode = stableCode("opt", axis);
    const existingOption = existingOptionByCode.get(optionCode);
    const option = existingOption
      ? (
          await tx
            .update(variantOptions)
            .set({
              name: axis,
              sortOrder,
              disabledAt: null,
              updatedAt: new Date(),
            })
            .where(eq(variantOptions.id, existingOption.id))
            .returning({ id: variantOptions.id })
        )[0]
      : (
          await tx
            .insert(variantOptions)
            .values({
              organizationId: orgId,
              familyId,
              name: axis,
              code: optionCode,
              sortOrder,
              disabledAt: null,
            })
            .returning({ id: variantOptions.id })
        )[0];
    optionIdByAxis.set(axis, option.id);
  }

  const optionIds = [...optionIdByAxis.values()];
  const existingValues = optionIds.length
    ? await tx
        .select({
          id: variantOptionValues.id,
          optionId: variantOptionValues.optionId,
          code: variantOptionValues.code,
        })
        .from(variantOptionValues)
        .where(inArray(variantOptionValues.optionId, optionIds))
    : [];
  const existingValueByOptionAndCode = new Map(
    existingValues.map((value) => [`${value.optionId}:${value.code}`, value])
  );

  for (const axis of axes) {
    const optionId = optionIdByAxis.get(axis);
    if (!optionId) continue;

    const labels: string[] = [];
    for (const seed of variantSeeds) {
      const label = seed.variantAttrs?.[axis];
      if (label && !labels.includes(label)) labels.push(label);
    }

    const valueIdByLabel = new Map<string, string>();
    const valueCodeByLabel = new Map<string, string>();
    for (const [sortOrder, label] of labels.entries()) {
      const valueCode = stableCode("val", label);
      const existingValue = existingValueByOptionAndCode.get(`${optionId}:${valueCode}`);
      const value = existingValue
        ? (
            await tx
              .update(variantOptionValues)
              .set({
                label,
                sortOrder,
                disabledAt: null,
                updatedAt: new Date(),
              })
              .where(eq(variantOptionValues.id, existingValue.id))
              .returning({ id: variantOptionValues.id })
          )[0]
        : (
            await tx
              .insert(variantOptionValues)
              .values({
                organizationId: orgId,
                optionId,
                label,
                code: valueCode,
                sortOrder,
                disabledAt: null,
              })
              .returning({ id: variantOptionValues.id })
          )[0];
      valueIdByLabel.set(label, value.id);
      valueCodeByLabel.set(label, valueCode);
    }
    valueIdByAxisAndLabel.set(axis, valueIdByLabel);
    valueCodeByAxisAndLabel.set(axis, valueCodeByLabel);
  }

  return {
    axes,
    optionIdByAxis,
    valueIdByAxisAndLabel,
    valueCodeByAxisAndLabel,
  };
}

async function syncItemVariantValuesInTx(
  tx: Tx,
  orgId: string,
  itemId: string,
  seed: ItemSeed,
  optionMap: FamilyOptionMap
) {
  await tx.delete(itemVariantValues).where(eq(itemVariantValues.itemId, itemId));

  if (!seed.variantAttrs || optionMap.axes.length === 0) return;

  const values = optionMap.axes.map((axis) => {
    const optionId = optionMap.optionIdByAxis.get(axis);
    const label = seed.variantAttrs?.[axis];
    const optionValueId = label
      ? optionMap.valueIdByAxisAndLabel.get(axis)?.get(label)
      : null;
    if (!optionId || !optionValueId) {
      throw new Error(`Variant ${seed.name} is missing a configured ${axis} value.`);
    }
    return {
      organizationId: orgId,
      itemId,
      optionId,
      optionValueId,
      updatedAt: new Date(),
    };
  });

  if (values.length > 0) {
    await tx.insert(itemVariantValues).values(values);
  }
}

export function planItemsSync(
  seeds: ItemSeed[],
  unitByKey: Map<string, UnitSeed>,
  existingUnitsBySignature: Map<string, ExistingUnit>,
  existingItemsBySku: Map<string, ExistingItem>,
  existingItemsByName: Map<string, ExistingItem[]>,
  matchedItemByKey: Map<string, ExistingItem>,
  report: Report
) {
  const orderedSeeds = orderSeedsForSync(seeds);

  for (const seed of orderedSeeds) {
    if (seed.isMaster === true) continue;

    const existing = findExistingItem(seed, existingItemsBySku, existingItemsByName, {
      allowNameMatch: true,
      nameMatchPredicate: (item) => item.isMaster !== true,
    });
    const desiredUnitSeed = seed.unitKey ? unitByKey.get(seed.unitKey) : null;
    if (!desiredUnitSeed) {
      throw new Error(`Unknown unit key "${seed.unitKey}" for ${seed.name}.`);
    }
    const desiredUnit = desiredUnitSeed
      ? existingUnitsBySignature.get(
          getUnitSignature(desiredUnitSeed.name, desiredUnitSeed.size, desiredUnitSeed.uom)
        )
      : null;
    if (!existing) {
      report.createdItems.push(seed.name);
    } else if (existing.deletedAt) {
      matchedItemByKey.set(seed.key, existing);
      report.reactivatedItems.push(seed.name);
    } else if (
      existing.sku !== seed.sku ||
      existing.name !== seed.name ||
      existing.itemType !== seed.itemType ||
      (desiredUnit ? existing.unitDefinitionId !== desiredUnit.id : true) ||
      existing.familyId == null ||
      existing.isMaster !== false ||
      existing.parentId !== null ||
      (existing.category ?? null) !== seed.category ||
      (existing.description ?? null) !== seed.description ||
      (seed.defaultPurchasePrice !== undefined &&
        !numericStringEquals(existing.defaultPurchasePrice, seed.defaultPurchasePrice)) ||
      (seed.currentStockUnitCost !== undefined &&
        !numericStringEquals(existing.currentStockUnitCost, resolveSeedCurrentStockUnitCost(seed))) ||
      (seed.defaultSellingPrice !== undefined &&
        !numericStringEquals(existing.defaultSellingPrice, seed.defaultSellingPrice)) ||
      (seed.manufacturingMode !== undefined &&
        existing.manufacturingMode !== seed.manufacturingMode) ||
      (seed.expectedBatchYield !== undefined &&
        !numericStringEquals(existing.expectedBatchYield, seed.expectedBatchYield)) ||
      (seed.typicalBatchSize !== undefined &&
        !numericStringEquals(existing.typicalBatchSize, seed.typicalBatchSize)) ||
      (seed.typicalGroupSize !== undefined &&
        !numericStringEquals(existing.typicalGroupSize, seed.typicalGroupSize)) ||
      (seed.bomLocked !== undefined && existing.bomLocked !== seed.bomLocked) ||
      (seed.safetyStock !== undefined &&
        !numericStringEquals(existing.safetyStock, seed.safetyStock ?? "0"))
    ) {
      matchedItemByKey.set(seed.key, existing);
      report.updatedItems.push(seed.name);
    } else {
      matchedItemByKey.set(seed.key, existing);
      report.unchangedItems.push(seed.name);
    }

    if (seed.unresolvedFormulaNote) {
      report.unresolvedFormulae.push(seed.unresolvedFormulaNote);
    }
  }
}

export async function applyItemsSyncInTx(
  tx: Tx,
  seeds: ItemSeed[],
  orgId: string,
  unitIdByKey: Map<string, string>,
  itemBySku: Map<string, ExistingItem>,
  itemByName: Map<string, ExistingItem[]>,
  itemIdByKey: Map<string, string>,
  report: Report,
  internalOnlyProductCategories?: Set<string>
) {
  const orderedSeeds = orderSeedsForSync(seeds);
  const familyIdByKey = new Map<string, string>();
  const optionMapByFamilyKey = new Map<string, FamilyOptionMap>();

  for (const familySeed of seeds.filter(isFamilySeed)) {
    const familyKey = familySeed.key;
    const variants = variantSeedsForFamily(seeds, familySeed);
    const unitKey = firstVariantUnitKey(seeds, familySeed);
    const unitDefinitionId = unitKey ? unitIdByKey.get(unitKey) : null;
    if (!unitDefinitionId) {
      throw new Error(`Unit key "${unitKey ?? "(none)"}" was not resolved for ${familySeed.name}.`);
    }

    const purchaseUnitDefinitionId = familySeed.purchaseUnitKey
      ? unitIdByKey.get(familySeed.purchaseUnitKey) ?? null
      : null;
    const existingFamilyId = findExistingFamilyId(
      familySeed,
      variants,
      itemBySku,
      itemByName
    );
    const familyValues = {
      organizationId: orgId,
      itemType: familySeed.itemType,
      name: familySeed.name,
      category: familySeed.category,
      description: familySeed.description,
      unitDefinitionId,
      purchaseUnitDefinitionId,
      purchaseToStockFactor: familySeed.purchaseToStockFactor ?? null,
      deletedAt: null,
      updatedAt: new Date(),
    };
    const familyId = existingFamilyId
      ? (
          await tx
            .update(itemFamilies)
            .set(familyValues)
            .where(eq(itemFamilies.id, existingFamilyId))
            .returning({ id: itemFamilies.id })
        )[0].id
      : (
          await tx
            .insert(itemFamilies)
            .values(familyValues)
            .returning({ id: itemFamilies.id })
        )[0].id;

    familyIdByKey.set(familyKey, familyId);

    const axes = axesForFamily(familySeed, variants);
    optionMapByFamilyKey.set(
      familyKey,
      await syncFamilyOptionsInTx(tx, orgId, familyId, axes, variants)
    );

    if (familySeed.isMaster) {
      const existingMaster = findExistingForSeed(familySeed, itemBySku, itemByName);
      if (existingMaster && existingMaster.deletedAt == null) {
        await tx
          .update(items)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(items.id, existingMaster.id));
      }
    }
  }

  for (const seed of orderedSeeds.filter((item) => item.isMaster !== true)) {
    const unitDefinitionId = seed.unitKey ? unitIdByKey.get(seed.unitKey) : null;
    if (!unitDefinitionId) {
      throw new Error(`Unit key "${seed.unitKey}" was not resolved for ${seed.name}.`);
    }

    const purchaseUnitDefinitionId = seed.purchaseUnitKey
      ? unitIdByKey.get(seed.purchaseUnitKey) ?? null
      : undefined;
    const familyKey = familyKeyForSeed(seed);
    const familyId = familyIdByKey.get(familyKey);
    const optionMap = optionMapByFamilyKey.get(familyKey);
    if (!familyId || !optionMap) {
      throw new Error(`Family was not resolved for ${seed.name}.`);
    }
    const optionCombinationKey = optionCombinationKeyForVariant(
      optionMap.axes,
      optionMap.valueCodeByAxisAndLabel,
      seed.variantAttrs
    );

    const existing = findExistingForSeed(seed, itemBySku, itemByName);
    if (!existing) {
      const sellable = resolveSeedSellable(seed, internalOnlyProductCategories);
      const [created] = await tx
        .insert(items)
        .values({
          organizationId: orgId,
          name: seed.name,
          sku: seed.sku,
          itemType: seed.itemType,
          unitDefinitionId: unitDefinitionId ?? null,
          category: seed.category,
          description: seed.description,
          defaultPurchasePrice: seed.defaultPurchasePrice ?? null,
          currentStockUnitCost: resolveSeedCurrentStockUnitCost(seed),
          defaultSellingPrice: seed.defaultSellingPrice ?? null,
          safetyStock: seed.safetyStock ?? "0",
          purchaseUnitDefinitionId: purchaseUnitDefinitionId ?? null,
          purchaseToStockFactor: seed.purchaseToStockFactor ?? null,
          manufacturingMode: seed.manufacturingMode ?? "discrete",
          expectedBatchYield: seed.expectedBatchYield ?? null,
          typicalBatchSize: seed.typicalBatchSize ?? null,
          typicalGroupSize: seed.typicalGroupSize ?? null,
          bomLocked: seed.bomLocked ?? false,
          familyId,
          optionCombinationKey,
          isMaster: false,
          parentId: null,
          variantAxes: null,
          variantAttrs: null,
          sellable,
        })
        .returning({ id: items.id });
      itemIdByKey.set(seed.key, created.id);
      await syncItemVariantValuesInTx(tx, orgId, created.id, seed, optionMap);
      report.createdItems.push(seed.name);
    } else {
      const sellable = resolveSeedSellable(seed, internalOnlyProductCategories);
      const nextValues: Record<string, unknown> = {
        sku: seed.sku,
        name: seed.name,
        itemType: seed.itemType,
        unitDefinitionId: unitDefinitionId ?? null,
        category: seed.category,
        description: seed.description,
        familyId,
        optionCombinationKey,
        isMaster: false,
        parentId: null,
        variantAxes: null,
        variantAttrs: null,
        sellable,
        deletedAt: null,
        updatedAt: new Date(),
      };

      if (seed.defaultPurchasePrice !== undefined) {
        nextValues.defaultPurchasePrice = seed.defaultPurchasePrice;
      }
      if (seed.currentStockUnitCost !== undefined) {
        nextValues.currentStockUnitCost = resolveSeedCurrentStockUnitCost(seed);
      }
      if (seed.defaultSellingPrice !== undefined) {
        nextValues.defaultSellingPrice = seed.defaultSellingPrice;
      }
      if (purchaseUnitDefinitionId !== undefined) {
        nextValues.purchaseUnitDefinitionId = purchaseUnitDefinitionId;
      }
      if (seed.purchaseToStockFactor !== undefined) {
        nextValues.purchaseToStockFactor = seed.purchaseToStockFactor;
      }
      if (seed.manufacturingMode !== undefined) {
        nextValues.manufacturingMode = seed.manufacturingMode;
      }
      if (seed.expectedBatchYield !== undefined) {
        nextValues.expectedBatchYield = seed.expectedBatchYield;
      }
      if (seed.typicalBatchSize !== undefined) {
        nextValues.typicalBatchSize = seed.typicalBatchSize;
      }
      if (seed.typicalGroupSize !== undefined) {
        nextValues.typicalGroupSize = seed.typicalGroupSize;
      }
      if (seed.bomLocked !== undefined) {
        nextValues.bomLocked = seed.bomLocked;
      }
      if (seed.safetyStock !== undefined) {
        nextValues.safetyStock = seed.safetyStock ?? "0";
      }

      const hasChanges =
        existing.sku !== seed.sku ||
        existing.name !== seed.name ||
        existing.itemType !== seed.itemType ||
        existing.unitDefinitionId !== (unitDefinitionId ?? null) ||
        (existing.category ?? null) !== seed.category ||
        (existing.description ?? null) !== seed.description ||
        existing.deletedAt != null ||
        (seed.defaultPurchasePrice !== undefined &&
          !numericStringEquals(existing.defaultPurchasePrice, seed.defaultPurchasePrice)) ||
        (seed.currentStockUnitCost !== undefined &&
          !numericStringEquals(existing.currentStockUnitCost, resolveSeedCurrentStockUnitCost(seed))) ||
        (seed.defaultSellingPrice !== undefined &&
          !numericStringEquals(existing.defaultSellingPrice, seed.defaultSellingPrice)) ||
        (purchaseUnitDefinitionId !== undefined &&
          existing.purchaseUnitDefinitionId !== purchaseUnitDefinitionId) ||
        (seed.purchaseToStockFactor !== undefined &&
          !numericStringEquals(existing.purchaseToStockFactor, seed.purchaseToStockFactor)) ||
        (seed.manufacturingMode !== undefined &&
          existing.manufacturingMode !== seed.manufacturingMode) ||
        (seed.expectedBatchYield !== undefined &&
          !numericStringEquals(existing.expectedBatchYield, seed.expectedBatchYield)) ||
        (seed.typicalBatchSize !== undefined &&
          !numericStringEquals(existing.typicalBatchSize, seed.typicalBatchSize)) ||
        (seed.typicalGroupSize !== undefined &&
          !numericStringEquals(existing.typicalGroupSize, seed.typicalGroupSize)) ||
        (seed.bomLocked !== undefined && existing.bomLocked !== seed.bomLocked) ||
        (seed.safetyStock !== undefined &&
          !numericStringEquals(existing.safetyStock, seed.safetyStock ?? "0")) ||
        existing.familyId !== familyId ||
        existing.isMaster !== false ||
        existing.parentId !== null ||
        existing.sellable !== sellable ||
        JSON.stringify(existing.variantAxes ?? null) !== JSON.stringify(null) ||
        JSON.stringify(existing.variantAttrs ?? null) !== JSON.stringify(null);

      if (hasChanges) {
        await tx.update(items).set(nextValues).where(eq(items.id, existing.id));
        if (existing.deletedAt) {
          report.reactivatedItems.push(seed.name);
        } else {
          report.updatedItems.push(seed.name);
        }
      } else {
        report.unchangedItems.push(seed.name);
      }

      itemIdByKey.set(seed.key, existing.id);
      await syncItemVariantValuesInTx(tx, orgId, existing.id, seed, optionMap);
    }

    if (seed.unresolvedFormulaNote) {
      report.unresolvedFormulae.push(seed.unresolvedFormulaNote);
    }
  }
}
