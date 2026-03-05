// app/(dashboard)/inventory/types.ts
export type ItemRow = {
  id: string;
  name: string;
  sku: string | null;
  itemType: string;
  inStock: string;
  unit: string;
  category: string | null;
};
