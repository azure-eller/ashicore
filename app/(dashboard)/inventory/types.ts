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
  name: string;
  sku: string | null;
  stock: string;
  committedQty: string;
  demandQty: string;
  shortageQty: string;
  availableQty: string;
  expectedQty: string;
  safetyStock: string;
  defaultSellingPrice: string | null;
  unit: string | null;
  variantAttrs: Record<string, string> | null;
};

export type ItemRow = {
  id: string;
  name: string;
  displayName: string;
  sku: string | null;
  itemType: ItemType;
  stock: string;
  committedQty: string;
  demandQty: string;
  shortageQty: string;
  availableQty: string;
  expectedQty: string;
  safetyStock: string;
  currentStockUnitCost: string | null;
  unit: string | null;
  unitSize: string | null;
  unitUom: string | null;
  category: string | null;
  potential: string | null;
  estimatedUnitCost: string | null;
  marginPercent: string | null;
  marginTier: "negative" | "low" | "mid" | "high" | null;
  isMaster: boolean;
  parentId: string | null;
  variantCount: number;
  variantAxes: string[] | null;
  variantAttrs: Record<string, string> | null;
  priceRange: string | null;
  sellable: boolean | null;
  hasBom: boolean;
  usedInBom: boolean;
  usedInCount: number;
  revenue30d: string | null;
  createdAt: Date;
  subRows?: ItemRow[];
};

export const REPLENISHMENT_STATUS_VALUES = [
  "order-now",
  "order-soon",
  "stocked",
] as const;

export type ReplenishmentStatus = (typeof REPLENISHMENT_STATUS_VALUES)[number];

function parseQuantity(value: string | null | undefined) {
  const parsed = parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

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
  row: Pick<ItemRow, "stock" | "demandQty" | "expectedQty" | "safetyStock" | "shortageQty">,
): ReplenishmentStatus {
  const projectedStock = calcProjectedStock(row);
  const safetyStock = Math.max(0, parseQuantity(row.safetyStock));
  const shortage = parseQuantity(row.shortageQty);

  if (shortage > 0 || (safetyStock > 0 && projectedStock <= safetyStock)) {
    return "order-now";
  }

  if (safetyStock > 0 && projectedStock <= safetyStock * 1.4) {
    return "order-soon";
  }

  return "stocked";
}
