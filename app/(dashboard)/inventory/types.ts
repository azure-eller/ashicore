export const ITEM_TYPES = ["product", "material"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

// Maps each item type to its URL segment. Use this instead of `${itemType}s` string append.
export const ITEM_TYPE_SEGMENTS: Record<ItemType, string> = {
  material: "materials",
  product: "products",
};

export type ItemRow = {
  id: string;
  name: string;
  sku: string | null;
  itemType: ItemType;
  inStock: string;
  committedQty: string;
  expectedQty: string;
  safetyStock: string;
  unit: string;
  category: string | null;
};

export function calcStock(
  row: Pick<ItemRow, "inStock" | "committedQty" | "expectedQty" | "safetyStock">,
): number {
  const result =
    parseFloat(row.inStock) -
    parseFloat(row.committedQty) +
    parseFloat(row.expectedQty) -
    parseFloat(row.safetyStock);
  return Math.round(result * 10000) / 10000;
}
