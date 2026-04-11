export const ITEM_TYPES = ["product", "material"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

// Maps each item type to its URL segment. Use this instead of `${itemType}s` string append.
export const ITEM_TYPE_SEGMENTS: Record<ItemType, string> = {
  material: "materials",
  product: "products",
};

export type VariantRow = {
  id: string;
  name: string;
  sku: string | null;
  stock: string;
  committedQty: string;
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
  expectedQty: string;
  safetyStock: string;
  unit: string | null;
  unitSize: string | null;
  unitUom: string | null;
  category: string | null;
  potential: string | null;
  isMaster: boolean;
  parentId: string | null;
  variantCount: number;
  variantAxes: string[] | null;
  variantAttrs: Record<string, string> | null;
  priceRange: string | null;
  subRows?: ItemRow[];
};

export function calcStock(
  row: Pick<ItemRow, "stock" | "committedQty" | "expectedQty" | "safetyStock">,
): number {
  const result =
    parseFloat(row.stock) -
    parseFloat(row.committedQty) +
    parseFloat(row.expectedQty) -
    parseFloat(row.safetyStock);
  return Math.round(result * 10000) / 10000;
}
