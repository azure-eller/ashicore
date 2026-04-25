export const ITEM_TYPES = ["product", "material"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
export const INVENTORY_PRODUCT_VIEWS = ["products", "sub-assemblies"] as const;
export type InventoryProductView = (typeof INVENTORY_PRODUCT_VIEWS)[number];

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

export type InventoryTabCounts = {
  products: number;
  materials: number;
  subAssemblies: number;
};

export function calcStock(
  row: Pick<ItemRow, "stock" | "demandQty" | "expectedQty" | "safetyStock">,
): number {
  const result =
    parseFloat(row.stock) -
    parseFloat(row.demandQty) +
    parseFloat(row.expectedQty) -
    parseFloat(row.safetyStock);
  return Math.round(result * 10000) / 10000;
}
