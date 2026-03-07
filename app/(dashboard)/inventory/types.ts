// app/(dashboard)/inventory/types.ts
export const ITEM_TYPES = ["product", "material"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export type ItemRow = {
  id: string;
  name: string;
  sku: string | null;
  itemType: string;
  inStock: string;
  unit: string;
  category: string | null;
};
