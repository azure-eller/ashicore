import {
  normalizeStockUnitCost,
  resolveStockUnitCostFromDefaultPurchasePrice,
} from "@/lib/inventory/cost";
import { normalizeNumericScale } from "@/lib/format";
import { isValidIsoDate } from "@/lib/schemas/shared";
import type {
  ExistingItem,
  InitialStockEntry,
  InitialStockLotEntry,
  ItemSeed,
} from "./types";

export function resolveSeedSellable(
  seed: ItemSeed,
  internalOnlyProductCategories?: Set<string>
) {
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
  entry: InitialStockLotEntry
): { stockQuantity: number; sourceLabel: string } {
  if (typeof entry === "string") {
    return { stockQuantity: Number(entry), sourceLabel: entry };
  }

  const inputQty = Number(entry.quantity);

  if (entry.unitKey == null) {
    return { stockQuantity: inputQty, sourceLabel: entry.quantity };
  }

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

export function resolveSeedOpeningReceivedAt(entry: InitialStockLotEntry): Date {
  if (typeof entry === "string") {
    return new Date();
  }

  if (entry.ageDays != null && entry.receivedAt != null) {
    throw new Error("Opening stock can define ageDays or receivedAt, not both.");
  }

  if (entry.ageDays != null) {
    if (!Number.isInteger(entry.ageDays) || entry.ageDays < 0) {
      throw new Error("Opening stock ageDays must be a non-negative whole number.");
    }

    const receivedAt = new Date();
    receivedAt.setDate(receivedAt.getDate() - entry.ageDays);
    receivedAt.setHours(12, 0, 0, 0);
    return receivedAt;
  }

  if (entry.receivedAt != null) {
    if (!isValidIsoDate(entry.receivedAt)) {
      throw new Error(`Opening stock receivedAt is invalid: ${entry.receivedAt}`);
    }
    return new Date(`${entry.receivedAt}T12:00:00`);
  }

  return new Date();
}

export function resolveSeedOpeningLotEntries(
  entry: InitialStockEntry
): InitialStockLotEntry[] {
  return Array.isArray(entry) ? entry : [entry];
}

function resolveSeedDirectOpeningUnitCost(seed: ItemSeed) {
  if (seed.itemType !== "material") {
    return null;
  }

  return (
    resolveSeedCurrentStockUnitCost(seed) ??
    resolveStockUnitCostFromDefaultPurchasePrice({
      defaultPurchasePrice: seed.defaultPurchasePrice ?? null,
      purchaseToStockFactor: seed.purchaseToStockFactor ?? null,
    })
  );
}

function resolveSeedAverageComponentQuantity(
  seed: ItemSeed,
  component: NonNullable<ItemSeed["bom"]>[number]
) {
  const quantity = Number.parseFloat(component.quantity);
  if (!Number.isFinite(quantity)) {
    return null;
  }

  if (seed.manufacturingMode !== "batch") {
    return quantity;
  }

  const basis = Number.parseFloat(seed.expectedBatchYield ?? seed.typicalBatchSize ?? "");
  if (!Number.isFinite(basis) || basis <= 0) {
    return null;
  }

  return quantity / basis;
}

export function resolveSeedOpeningUnitCost(
  seed: ItemSeed,
  seedByKey?: Map<string, ItemSeed>,
  visited = new Set<string>()
): string | null {
  const directUnitCost = resolveSeedDirectOpeningUnitCost(seed);
  if (directUnitCost != null) {
    return directUnitCost;
  }

  if (seed.itemType !== "product" || !seedByKey || !seed.bom?.length) {
    return null;
  }

  if (visited.has(seed.key)) {
    return null;
  }

  const nextVisited = new Set(visited);
  nextVisited.add(seed.key);

  let totalCost = 0;
  for (const component of seed.bom) {
    const componentSeed = seedByKey.get(component.componentKey);
    const averageComponentQuantity = resolveSeedAverageComponentQuantity(
      seed,
      component
    );
    if (!componentSeed || averageComponentQuantity == null) {
      return null;
    }

    const componentUnitCost = resolveSeedOpeningUnitCost(
      componentSeed,
      seedByKey,
      nextVisited
    );
    if (componentUnitCost == null) {
      return null;
    }

    totalCost += averageComponentQuantity * Number.parseFloat(componentUnitCost);
  }

  return normalizeNumericScale(totalCost, 6);
}

export function orderSeedsForSync(itemSeeds: ItemSeed[]) {
  return [...itemSeeds];
}

export function findExistingItem(
  seed: ItemSeed,
  existingItemsBySku: Map<string, ExistingItem>,
  existingItemsByName: Map<string, ExistingItem[]>,
  options?: {
    allowNameMatch?: boolean;
    nameMatchPredicate?: (existing: ExistingItem) => boolean;
  }
) {
  const skuCandidates = [seed.sku, ...(seed.legacySkus ?? [])].filter(
    (sku): sku is string => sku != null
  );
  for (const sku of skuCandidates) {
    const existing = existingItemsBySku.get(sku);
    if (existing) return existing;
  }

  if (options?.allowNameMatch === false) {
    return null;
  }

  const nameCandidates = [seed.name, ...(seed.legacyNames ?? [])];
  for (const name of nameCandidates) {
    const matches = existingItemsByName.get(name) ?? [];
    const existing = options?.nameMatchPredicate
      ? matches.find(options.nameMatchPredicate)
      : matches[0];
    if (existing) {
      return existing;
    }
  }

  return null;
}

export function buildExistingItemsByName(existingItems: ExistingItem[]) {
  const byName = new Map<string, ExistingItem[]>();

  for (const item of existingItems) {
    const bucket = byName.get(item.name) ?? [];
    bucket.push(item);
    byName.set(item.name, bucket);
  }

  return byName;
}
