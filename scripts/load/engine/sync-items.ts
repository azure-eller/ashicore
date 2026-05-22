import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  itemFamilies,
  items,
  itemVariantValues,
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

type VariantAssignmentTarget = {
  familyId: string;
  optionId: string | null;
  optionValueId: string | null;
  optionCombinationKey: string;
};

function getRequiredSeedFamilyField(
  seed: ItemSeed,
  field: keyof Pick<
    ItemSeed,
    | "familyName"
    | "familyCategory"
    | "familyUnitKey"
    | "variantOptionName"
    | "variantOptionCode"
    | "variantOptionValue"
    | "variantOptionValueCode"
  >
) {
  const value = seed[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${seed.key} is missing required ${field} for family sync.`);
  }
  return value;
}

function assertCompatibleFamilySeed(
  left: ItemSeed,
  right: ItemSeed,
) {
  const fields: Array<
    keyof Pick<
      ItemSeed,
      | "familyName"
      | "familyCategory"
      | "familyDescription"
      | "familyUnitKey"
      | "variantOptionName"
      | "variantOptionCode"
      | "purchaseUnitKey"
      | "purchaseToStockFactor"
    >
  > = [
    "familyName",
    "familyCategory",
    "familyDescription",
    "familyUnitKey",
    "variantOptionName",
    "variantOptionCode",
    "purchaseUnitKey",
    "purchaseToStockFactor",
  ];

  for (const field of fields) {
    if ((left[field] ?? null) !== (right[field] ?? null)) {
      throw new Error(
        `Family seed "${left.familyKey}" has conflicting ${field} values: ${String(
          left[field]
        )} vs ${String(right[field])}.`
      );
    }
  }
}

function resolveFamilyPurchaseFields(
  seed: ItemSeed,
  unitIdByKey: Map<string, string>
) {
  if (seed.itemType !== "material") {
    return {
      purchaseUnitDefinitionId: null,
      purchaseToStockFactor: null,
    };
  }

  const purchaseUnitDefinitionId = seed.purchaseUnitKey
    ? unitIdByKey.get(seed.purchaseUnitKey) ?? null
    : null;
  if (seed.purchaseUnitKey && !purchaseUnitDefinitionId) {
    throw new Error(
      `Purchase unit key "${seed.purchaseUnitKey}" was not resolved for ${seed.name}.`
    );
  }

  return {
    purchaseUnitDefinitionId,
    purchaseToStockFactor: seed.purchaseToStockFactor ?? null,
  };
}

async function prepareVariantFamiliesInTx(
  tx: Tx,
  seeds: ItemSeed[],
  orgId: string,
  unitIdByKey: Map<string, string>,
): Promise<Map<string, VariantAssignmentTarget>> {
  const variantSeeds = seeds.filter((seed) => seed.familyKey != null);
  const assignmentBySeedKey = new Map<string, VariantAssignmentTarget>();
  if (variantSeeds.length === 0) return assignmentBySeedKey;

  const familySeedByKey = new Map<string, ItemSeed>();
  for (const seed of variantSeeds) {
    const existing = familySeedByKey.get(seed.familyKey!);
    if (existing) {
      assertCompatibleFamilySeed(existing, seed);
    } else {
      familySeedByKey.set(seed.familyKey!, seed);
    }
  }

  const activeFamilies = await tx
    .select({
      id: itemFamilies.id,
      itemType: itemFamilies.itemType,
      name: itemFamilies.name,
      category: itemFamilies.category,
      description: itemFamilies.description,
      unitDefinitionId: itemFamilies.unitDefinitionId,
      purchaseUnitDefinitionId: itemFamilies.purchaseUnitDefinitionId,
      purchaseToStockFactor: itemFamilies.purchaseToStockFactor,
    })
    .from(itemFamilies)
    .where(isNull(itemFamilies.deletedAt));

  const familyIdByKey = new Map<string, string>();
  for (const [familyKey, seed] of familySeedByKey) {
    const familyName = getRequiredSeedFamilyField(seed, "familyName");
    const familyCategory = getRequiredSeedFamilyField(seed, "familyCategory");
    const familyUnitKey = getRequiredSeedFamilyField(seed, "familyUnitKey");
    const familyUnitId = unitIdByKey.get(familyUnitKey);
    if (!familyUnitId) {
      throw new Error(`Unit key "${familyUnitKey}" was not resolved for family ${familyName}.`);
    }
    const familyPurchaseFields = resolveFamilyPurchaseFields(seed, unitIdByKey);

    const matches = activeFamilies.filter(
      (family) => family.itemType === seed.itemType && family.name === familyName
    );
    if (matches.length > 1) {
      throw new Error(`Multiple active item families found for ${familyName}.`);
    }

    const familyDescription = seed.familyDescription ?? null;
    const existing = matches[0];
    if (!existing) {
      const [created] = await tx
        .insert(itemFamilies)
        .values({
          organizationId: orgId,
          itemType: seed.itemType,
          name: familyName,
          category: familyCategory,
          description: familyDescription,
          unitDefinitionId: familyUnitId,
          purchaseUnitDefinitionId: familyPurchaseFields.purchaseUnitDefinitionId,
          purchaseToStockFactor: familyPurchaseFields.purchaseToStockFactor,
        })
        .returning({ id: itemFamilies.id });
      familyIdByKey.set(familyKey, created.id);
      activeFamilies.push({
        id: created.id,
        itemType: seed.itemType,
        name: familyName,
        category: familyCategory,
        description: familyDescription,
        unitDefinitionId: familyUnitId,
        purchaseUnitDefinitionId: familyPurchaseFields.purchaseUnitDefinitionId,
        purchaseToStockFactor: familyPurchaseFields.purchaseToStockFactor,
      });
    } else {
      familyIdByKey.set(familyKey, existing.id);
      if (
        existing.category !== familyCategory ||
        (existing.description ?? null) !== familyDescription ||
        existing.unitDefinitionId !== familyUnitId ||
        existing.purchaseUnitDefinitionId !== familyPurchaseFields.purchaseUnitDefinitionId ||
        !numericStringEquals(
          existing.purchaseToStockFactor,
          familyPurchaseFields.purchaseToStockFactor
        )
      ) {
        await tx
          .update(itemFamilies)
          .set({
            category: familyCategory,
            description: familyDescription,
            unitDefinitionId: familyUnitId,
            purchaseUnitDefinitionId: familyPurchaseFields.purchaseUnitDefinitionId,
            purchaseToStockFactor: familyPurchaseFields.purchaseToStockFactor,
            updatedAt: new Date(),
          })
          .where(eq(itemFamilies.id, existing.id));
      }
    }
  }

  const familyIds = [...familyIdByKey.values()];
  const existingOptions =
    familyIds.length === 0
      ? []
      : await tx
          .select({
            id: variantOptions.id,
            familyId: variantOptions.familyId,
            name: variantOptions.name,
            code: variantOptions.code,
            sortOrder: variantOptions.sortOrder,
            disabledAt: variantOptions.disabledAt,
          })
          .from(variantOptions)
          .where(inArray(variantOptions.familyId, familyIds));

  const optionIdByFamilyAndCode = new Map<string, string>();
  for (const [familyKey, seed] of familySeedByKey) {
    const familyId = familyIdByKey.get(familyKey)!;
    const optionName = getRequiredSeedFamilyField(seed, "variantOptionName");
    const optionCode = getRequiredSeedFamilyField(seed, "variantOptionCode");
    const existing = existingOptions.find(
      (option) => option.familyId === familyId && option.code === optionCode
    );

    if (!existing) {
      const [created] = await tx
        .insert(variantOptions)
        .values({
          organizationId: orgId,
          familyId,
          name: optionName,
          code: optionCode,
          sortOrder: 0,
        })
        .returning({ id: variantOptions.id });
      optionIdByFamilyAndCode.set(`${familyId}:${optionCode}`, created.id);
    } else {
      optionIdByFamilyAndCode.set(`${familyId}:${optionCode}`, existing.id);
      if (existing.name !== optionName || existing.sortOrder !== 0 || existing.disabledAt != null) {
        await tx
          .update(variantOptions)
          .set({
            name: optionName,
            sortOrder: 0,
            disabledAt: null,
            updatedAt: new Date(),
          })
          .where(eq(variantOptions.id, existing.id));
      }
    }
  }

  const optionIds = [...optionIdByFamilyAndCode.values()];
  const existingValues =
    optionIds.length === 0
      ? []
      : await tx
          .select({
            id: variantOptionValues.id,
            optionId: variantOptionValues.optionId,
            label: variantOptionValues.label,
            code: variantOptionValues.code,
            sortOrder: variantOptionValues.sortOrder,
            disabledAt: variantOptionValues.disabledAt,
          })
          .from(variantOptionValues)
          .where(inArray(variantOptionValues.optionId, optionIds));
  const valueByOptionAndCode = new Map(
    existingValues.map((value) => [`${value.optionId}:${value.code}`, value])
  );
  const valueCountByOption = new Map<string, number>();
  for (const value of existingValues) {
    valueCountByOption.set(value.optionId, (valueCountByOption.get(value.optionId) ?? 0) + 1);
  }

  for (const seed of variantSeeds) {
    const familyId = familyIdByKey.get(seed.familyKey!)!;
    const optionCode = getRequiredSeedFamilyField(seed, "variantOptionCode");
    const optionId = optionIdByFamilyAndCode.get(`${familyId}:${optionCode}`)!;
    const valueLabel = getRequiredSeedFamilyField(seed, "variantOptionValue");
    const valueCode = getRequiredSeedFamilyField(seed, "variantOptionValueCode");
    const valueKey = `${optionId}:${valueCode}`;
    const existing = valueByOptionAndCode.get(valueKey);
    let optionValueId = existing?.id;

    if (!existing) {
      const sortOrder = valueCountByOption.get(optionId) ?? 0;
      const [created] = await tx
        .insert(variantOptionValues)
        .values({
          organizationId: orgId,
          optionId,
          label: valueLabel,
          code: valueCode,
          sortOrder,
        })
        .returning({ id: variantOptionValues.id });
      optionValueId = created.id;
      valueCountByOption.set(optionId, sortOrder + 1);
      valueByOptionAndCode.set(valueKey, {
        id: created.id,
        optionId,
        label: valueLabel,
        code: valueCode,
        sortOrder,
        disabledAt: null,
      });
    } else if (existing.label !== valueLabel || existing.disabledAt != null) {
      await tx
        .update(variantOptionValues)
        .set({
          label: valueLabel,
          disabledAt: null,
          updatedAt: new Date(),
        })
        .where(eq(variantOptionValues.id, existing.id));
    }

    assignmentBySeedKey.set(seed.key, {
      familyId,
      optionId,
      optionValueId: optionValueId!,
      optionCombinationKey: `${optionCode}=${valueCode}`,
    });
  }

  return assignmentBySeedKey;
}

async function prepareDefaultFamiliesInTx(
  tx: Tx,
  seeds: ItemSeed[],
  orgId: string,
  unitIdByKey: Map<string, string>,
  existingAssignmentBySeedKey: Map<string, VariantAssignmentTarget>
) {
  const defaultSeeds = seeds.filter(
    (seed) => seed.familyKey == null
  );
  if (defaultSeeds.length === 0) return existingAssignmentBySeedKey;

  const activeFamilies = await tx
    .select({
      id: itemFamilies.id,
      itemType: itemFamilies.itemType,
      name: itemFamilies.name,
      category: itemFamilies.category,
      description: itemFamilies.description,
      unitDefinitionId: itemFamilies.unitDefinitionId,
      purchaseUnitDefinitionId: itemFamilies.purchaseUnitDefinitionId,
      purchaseToStockFactor: itemFamilies.purchaseToStockFactor,
    })
    .from(itemFamilies)
    .where(isNull(itemFamilies.deletedAt));

  for (const seed of defaultSeeds) {
    if (!seed.unitKey) {
      throw new Error(`${seed.key} is missing unitKey for default family sync.`);
    }
    const familyUnitId = unitIdByKey.get(seed.unitKey);
    if (!familyUnitId) {
      throw new Error(`Unit key "${seed.unitKey}" was not resolved for ${seed.name}.`);
    }
    const familyPurchaseFields = resolveFamilyPurchaseFields(seed, unitIdByKey);

    const matches = activeFamilies.filter(
      (family) => family.itemType === seed.itemType && family.name === seed.name
    );
    const existing = matches.find(
      (family) =>
        family.unitDefinitionId === familyUnitId &&
        (family.category ?? null) === (seed.category ?? null)
    ) ?? matches[0];
    if (matches.length > 1 && !existing) {
      throw new Error(`Multiple active default item families found for ${seed.name}.`);
    }

    if (!existing) {
      const [created] = await tx
        .insert(itemFamilies)
        .values({
          organizationId: orgId,
          itemType: seed.itemType,
          name: seed.name,
          category: seed.category,
          description: seed.description,
          unitDefinitionId: familyUnitId,
          purchaseUnitDefinitionId: familyPurchaseFields.purchaseUnitDefinitionId,
          purchaseToStockFactor: familyPurchaseFields.purchaseToStockFactor,
        })
        .returning({ id: itemFamilies.id });
      existingAssignmentBySeedKey.set(seed.key, {
        familyId: created.id,
        optionId: null,
        optionValueId: null,
        optionCombinationKey: "",
      });
      activeFamilies.push({
        id: created.id,
        itemType: seed.itemType,
        name: seed.name,
        category: seed.category,
        description: seed.description,
        unitDefinitionId: familyUnitId,
        purchaseUnitDefinitionId: familyPurchaseFields.purchaseUnitDefinitionId,
        purchaseToStockFactor: familyPurchaseFields.purchaseToStockFactor,
      });
    } else {
      existingAssignmentBySeedKey.set(seed.key, {
        familyId: existing.id,
        optionId: null,
        optionValueId: null,
        optionCombinationKey: "",
      });
      if (
        existing.category !== seed.category ||
        (existing.description ?? null) !== seed.description ||
        existing.unitDefinitionId !== familyUnitId ||
        existing.purchaseUnitDefinitionId !== familyPurchaseFields.purchaseUnitDefinitionId ||
        !numericStringEquals(
          existing.purchaseToStockFactor,
          familyPurchaseFields.purchaseToStockFactor
        )
      ) {
        await tx
          .update(itemFamilies)
          .set({
            category: seed.category,
            description: seed.description,
            unitDefinitionId: familyUnitId,
            purchaseUnitDefinitionId: familyPurchaseFields.purchaseUnitDefinitionId,
            purchaseToStockFactor: familyPurchaseFields.purchaseToStockFactor,
            updatedAt: new Date(),
          })
          .where(eq(itemFamilies.id, existing.id));
      }
    }
  }

  return existingAssignmentBySeedKey;
}

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
      bomLocked: items.bomLocked,
      safetyStock: items.safetyStock,
      sellable: items.sellable,
      familyId: items.familyId,
      optionCombinationKey: items.optionCombinationKey,
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
    const existing = findExistingItem(seed, existingItemsBySku, existingItemsByName, {
      allowNameMatch: true,
      nameMatchPredicate: (item) => item.familyId != null,
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
  const variantAssignmentBySeedKey = await prepareDefaultFamiliesInTx(
    tx,
    orderedSeeds,
    orgId,
    unitIdByKey,
    await prepareVariantFamiliesInTx(tx, orderedSeeds, orgId, unitIdByKey)
  );

  for (const seed of orderedSeeds) {
    const variantAssignment = variantAssignmentBySeedKey.get(seed.key);
    const unitDefinitionId = seed.unitKey ? unitIdByKey.get(seed.unitKey) : null;
    if (!unitDefinitionId) {
      throw new Error(`Unit key "${seed.unitKey}" was not resolved for ${seed.name}.`);
    }

    const purchaseUnitDefinitionId = seed.purchaseUnitKey
      ? unitIdByKey.get(seed.purchaseUnitKey) ?? null
      : undefined;
    const existing = findExistingItem(seed, itemBySku, itemByName, {
      allowNameMatch: true,
      nameMatchPredicate: (item) => item.familyId != null,
    });
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
          bomLocked: seed.bomLocked ?? false,
          familyId: variantAssignment?.familyId ?? null,
          optionCombinationKey: variantAssignment?.optionCombinationKey ?? "",
          sellable,
        })
        .returning({ id: items.id });
      itemIdByKey.set(seed.key, created.id);
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
        familyId: variantAssignment?.familyId ?? null,
        optionCombinationKey: variantAssignment?.optionCombinationKey ?? "",
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
        (seed.bomLocked !== undefined && existing.bomLocked !== seed.bomLocked) ||
        (seed.safetyStock !== undefined &&
          !numericStringEquals(existing.safetyStock, seed.safetyStock ?? "0")) ||
        existing.familyId !== (variantAssignment?.familyId ?? null) ||
        existing.optionCombinationKey !== (variantAssignment?.optionCombinationKey ?? "") ||
        existing.sellable !== sellable;

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
    }

    const itemId = itemIdByKey.get(seed.key);
    if (itemId && variantAssignment) {
      await tx.delete(itemVariantValues).where(eq(itemVariantValues.itemId, itemId));
      if (variantAssignment.optionId && variantAssignment.optionValueId) {
        await tx.insert(itemVariantValues).values({
          organizationId: orgId,
          itemId,
          optionId: variantAssignment.optionId,
          optionValueId: variantAssignment.optionValueId,
        });
      }
    }

    if (seed.unresolvedFormulaNote) {
      report.unresolvedFormulae.push(seed.unresolvedFormulaNote);
    }
  }

  await tx
    .update(itemFamilies)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        isNull(itemFamilies.deletedAt),
        inArray(
          itemFamilies.id,
          tx
            .select({ id: itemFamilies.id })
            .from(itemFamilies)
            .innerJoin(variantOptions, eq(variantOptions.familyId, itemFamilies.id))
            .where(
              and(
                eq(variantOptions.name, "Package"),
                sql`NOT EXISTS (
                  SELECT 1
                  FROM inventory.items active_item
                  WHERE active_item.family_id = ${itemFamilies.id}
                    AND active_item.deleted_at IS NULL
                )`
              )
            )
        )
      )
    );
}
