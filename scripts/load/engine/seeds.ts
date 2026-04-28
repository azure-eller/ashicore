import {
  normalizeStockUnitCost,
  resolveStockUnitCostFromDefaultPurchasePrice,
} from "@/lib/inventory/cost";
import type { ExistingItem, InitialStockEntry, ItemSeed } from "./types";

export function resolveSeedSellable(
  seed: ItemSeed,
  internalOnlyProductCategories?: Set<string>
) {
  if (seed.isMaster) {
    return null;
  }

  if (seed.sellable !== undefined) {
    return seed.sellable;
  }

  if (
    seed.itemType === "product" &&
    internalOnlyProductCategories?.has(seed.category)
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

// Resolve an opening stock entry to a concrete stock-unit quantity.
// Throws on misconfiguration (unknown unit, purchase unit without factor)
// because silent fallback is exactly the bug class this dual-unit support
// exists to prevent.
export function resolveSeedOpeningQuantity(
  seed: ItemSeed,
  entry: InitialStockEntry
): { stockQuantity: number; sourceLabel: string } {
  if (typeof entry === "string") {
    return { stockQuantity: Number(entry), sourceLabel: entry };
  }

  const inputQty = Number(entry.quantity);

  if (entry.unitKey === seed.unitKey) {
    return { stockQuantity: inputQty, sourceLabel: `${entry.quantity} ${entry.unitKey}` };
  }

  if (entry.unitKey === seed.purchaseUnitKey) {
    if (!seed.purchaseToStockFactor) {
      throw new Error(
        `Opening stock for ${seed.name} (${seed.sku}) was entered in purchase unit "${entry.unitKey}" but the seed defines no purchaseToStockFactor.`
      );
    }
    const factor = Number(seed.purchaseToStockFactor);
    return {
      stockQuantity: inputQty * factor,
      sourceLabel: `${entry.quantity} ${entry.unitKey} → ${inputQty * factor} ${seed.unitKey}`,
    };
  }

  throw new Error(
    `Opening stock for ${seed.name} (${seed.sku}) was entered in unit "${entry.unitKey}" but the seed only defines stockUnit="${seed.unitKey}" and purchaseUnit="${seed.purchaseUnitKey ?? "(none)"}".`
  );
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
