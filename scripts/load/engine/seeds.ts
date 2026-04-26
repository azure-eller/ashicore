import {
  normalizeStockUnitCost,
  resolveStockUnitCostFromDefaultPurchasePrice,
} from "@/lib/inventory/cost";
import type { ExistingItem, ItemSeed } from "./types";

const INTERNAL_ONLY_PRODUCT_CATEGORIES = new Set([
  "Packaging Assemblies",
  "Nutrient Packs",
]);

export function resolveSeedSellable(seed: ItemSeed) {
  if (seed.isMaster) {
    return null;
  }

  if (seed.sellable !== undefined) {
    return seed.sellable;
  }

  if (
    seed.itemType === "product" &&
    INTERNAL_ONLY_PRODUCT_CATEGORIES.has(seed.category)
  ) {
    return false;
  }

  return true;
}

export function resolveSeedCurrentStockUnitCost(seed: ItemSeed) {
  if (seed.currentStockUnitCost == null) {
    return null;
  }

  return normalizeStockUnitCost(Number.parseFloat(seed.currentStockUnitCost));
}

export function resolveSeedOpeningUnitCost(seed: ItemSeed) {
  return (
    resolveSeedCurrentStockUnitCost(seed) ??
    resolveStockUnitCostFromDefaultPurchasePrice({
      defaultPurchasePrice: seed.defaultPurchasePrice ?? null,
      purchaseToStockFactor: seed.purchaseToStockFactor ?? null,
    })
  );
}

export function orderSeedsForSync(itemSeeds: ItemSeed[]) {
  return [...itemSeeds].sort((left, right) => {
    const leftRank = left.isMaster ? 0 : 1;
    const rightRank = right.isMaster ? 0 : 1;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return 0;
  });
}

export function findExistingItem(
  seed: ItemSeed,
  existingItemsBySku: Map<string, ExistingItem>,
  existingItemsByName: Map<string, ExistingItem>,
  options?: { allowNameMatch?: boolean }
) {
  const skuCandidates = [seed.sku, ...(seed.legacySkus ?? [])];
  for (const sku of skuCandidates) {
    const existing = existingItemsBySku.get(sku);
    if (existing) return existing;
  }

  if (options?.allowNameMatch === false) {
    return null;
  }

  const nameCandidates = [seed.name, ...(seed.legacyNames ?? [])];
  for (const name of nameCandidates) {
    const existing = existingItemsByName.get(name);
    if (existing) return existing;
  }

  return null;
}
