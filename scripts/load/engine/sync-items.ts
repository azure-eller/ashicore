import { eq } from "drizzle-orm";
import { items } from "@/lib/db/schema";
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
    const isMaster = seed.isMaster === true;
    const existing = findExistingItem(seed, existingItemsBySku, existingItemsByName, {
      allowNameMatch: true,
      nameMatchPredicate: isMaster
        ? (item) => item.isMaster === true
        : (item) => item.isMaster !== true,
    });
    const desiredUnitSeed = seed.unitKey ? unitByKey.get(seed.unitKey) : null;
    if (!isMaster && !desiredUnitSeed) {
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
      (isMaster
        ? existing.unitDefinitionId !== null
        : desiredUnit
          ? existing.unitDefinitionId !== desiredUnit.id
          : true) ||
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
      (seed.safetyStock !== undefined &&
        !numericStringEquals(existing.safetyStock, seed.safetyStock ?? "0")) ||
      JSON.stringify(existing.variantAxes ?? null) !== JSON.stringify(seed.variantAxes ?? null) ||
      JSON.stringify(existing.variantAttrs ?? null) !== JSON.stringify(seed.variantAttrs ?? null)
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

  for (const seed of orderedSeeds) {
    const isMaster = seed.isMaster === true;
    const unitDefinitionId = seed.unitKey ? unitIdByKey.get(seed.unitKey) : null;
    if (!isMaster && !unitDefinitionId) {
      throw new Error(`Unit key "${seed.unitKey}" was not resolved for ${seed.name}.`);
    }

    const purchaseUnitDefinitionId = seed.purchaseUnitKey
      ? unitIdByKey.get(seed.purchaseUnitKey) ?? null
      : undefined;
    const resolvedParentId = seed.parentKey
      ? itemIdByKey.get(seed.parentKey) ?? null
      : null;

    const existing = findExistingItem(seed, itemBySku, itemByName, {
      allowNameMatch: true,
      nameMatchPredicate: isMaster
        ? (item) => item.isMaster === true
        : (item) => item.isMaster !== true,
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
          isMaster: seed.isMaster ?? false,
          parentId: resolvedParentId,
          variantAxes: seed.variantAxes ?? null,
          variantAttrs: seed.variantAttrs ?? null,
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
        isMaster: seed.isMaster ?? false,
        parentId: resolvedParentId,
        variantAxes: seed.variantAxes ?? null,
        variantAttrs: seed.variantAttrs ?? null,
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
        (seed.safetyStock !== undefined &&
          !numericStringEquals(existing.safetyStock, seed.safetyStock ?? "0")) ||
        existing.isMaster !== (seed.isMaster ?? false) ||
        existing.parentId !== resolvedParentId ||
        existing.sellable !== sellable ||
        JSON.stringify(existing.variantAxes ?? null) !== JSON.stringify(seed.variantAxes ?? null) ||
        JSON.stringify(existing.variantAttrs ?? null) !== JSON.stringify(seed.variantAttrs ?? null);

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

    if (seed.unresolvedFormulaNote) {
      report.unresolvedFormulae.push(seed.unresolvedFormulaNote);
    }
  }

  // Second pass: ensure parent IDs are wired up after all items exist.
  for (const seed of orderedSeeds) {
    if (!seed.parentKey) continue;

    const itemId = itemIdByKey.get(seed.key);
    const parentId = itemIdByKey.get(seed.parentKey);

    if (!itemId || !parentId) continue;

    await tx
      .update(items)
      .set({
        parentId,
        updatedAt: new Date(),
      })
      .where(eq(items.id, itemId));
  }
}
