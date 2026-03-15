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
  stock: string;
  unit: string;
  category: string | null;
};
