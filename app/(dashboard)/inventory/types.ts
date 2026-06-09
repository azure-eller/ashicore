import { parseQuantity } from "@/lib/format";

export const ITEM_TYPES = ["product", "material"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

// Maps each item type to its URL segment. Use this instead of `${itemType}s` string append.
export const ITEM_TYPE_SEGMENTS: Record<ItemType, string> = {
  material: "materials",
  product: "products",
};

export function itemDetailHref(itemType: ItemType | string, id: string) {
  const segment = ITEM_TYPE_SEGMENTS[itemType as ItemType] ?? "products";
  return `/inventory/${segment}/${id}`;
}

export type VariantRow = {
  id: string;
  familyId: string | null;
  familyName: string | null;
  name: string;
  displayName: string;
  sku: string | null;
  stock: string;
  demandQty: string;
  availableQty: string;
  expectedQty: string;
  safetyStock: string;
  defaultSellingPrice: string | null;
  unit: string | null;
  optionCombinationKey: string;
  optionValues: VariantOptionValueDisplay[];
  duplicateCombinationWarnings: DuplicateCombinationWarning[];
};

export type VariantOptionValueDisplay = {
  optionId: string;
  optionName: string;
  optionCode: string;
  valueId: string;
  valueLabel: string;
  valueCode: string;
  optionDisabledAt: Date | null;
  valueDisabledAt: Date | null;
};

export type DuplicateCombinationWarning = {
  variantId: string;
  duplicateOfVariantIds: string[];
  optionCombinationKey: string;
  message: string;
};

export type ItemRow = {
  id: string;
  familyId: string | null;
  familyName: string | null;
  name: string;
  displayName: string;
  sku: string | null;
  itemType: ItemType;
  lotTrackingMode: "tracked" | "untracked";
  stock: string;
  demandQty: string;
  availableQty: string;
  expectedQty: string;
  safetyStock: string;
  currentStockUnitCost: string | null;
  unit: string | null;
  unitSize: string | null;
  unitUom: string | null;
  category: string | null;
  optionCombinationKey: string;
  optionValues: VariantOptionValueDisplay[];
  duplicateCombinationWarnings: DuplicateCombinationWarning[];
  potential: string | null;
  estimatedUnitCost: string | null;
  marginPercent: string | null;
  marginTier: "negative" | "low" | "mid" | "high" | null;
  variantCount: number;
  priceRange: string | null;
  sellable: boolean | null;
  hasBom: boolean;
  usedInBom: boolean;
  usedInCount: number;
  revenue30d: string | null;
  createdAt: Date;
  lastCountedAt: string | null;
  subRows?: ItemRow[];
};

export const REPLENISHMENT_STATUS_VALUES = [
  "order-now",
  "order-soon",
  "stocked",
] as const;

export type ReplenishmentStatus = (typeof REPLENISHMENT_STATUS_VALUES)[number];

export function calcStock(
  row: Pick<ItemRow, "stock" | "demandQty" | "expectedQty" | "safetyStock">,
): number {
  const result =
    parseQuantity(row.stock) -
    parseQuantity(row.demandQty) +
    parseQuantity(row.expectedQty) -
    parseQuantity(row.safetyStock);
  return Math.round(result * 10000) / 10000;
}

export function calcProjectedStock(
  row: Pick<ItemRow, "stock" | "demandQty" | "expectedQty">,
): number {
  const result =
    parseQuantity(row.stock) -
    parseQuantity(row.demandQty) +
    parseQuantity(row.expectedQty);
  return Math.round(result * 10000) / 10000;
}

export function getReplenishmentStatus(
  row: Pick<ItemRow, "stock" | "demandQty" | "expectedQty" | "safetyStock">,
): ReplenishmentStatus {
  const projectedStock = calcProjectedStock(row);
  const safetyStock = Math.max(0, parseQuantity(row.safetyStock));

  if (projectedStock < 0 || (safetyStock > 0 && projectedStock <= safetyStock)) {
    return "order-now";
  }

  if (safetyStock > 0 && projectedStock <= safetyStock * 1.4) {
    return "order-soon";
  }

  return "stocked";
}
