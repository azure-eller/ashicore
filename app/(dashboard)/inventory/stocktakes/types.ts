import type {
  StocktakeScope,
  StocktakeStatus,
} from "@/lib/schemas/stocktakes";
import type { ItemType } from "@/app/(dashboard)/inventory/types";

export function formatScope(scope: StocktakeScope) {
  if (scope === "all") return "All Items";
  if (scope === "material") return "Materials";
  return "Products";
}

export type StocktakeListRow = {
  id: string;
  name: string;
  scope: StocktakeScope;
  status: StocktakeStatus;
  notes: string | null;
  itemCount: number;
  countedCount: number;
  varianceCount: number;
  completedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type StocktakeDetailLine = {
  id: string;
  itemId: string;
  itemName: string;
  itemSku: string | null;
  itemType: ItemType;
  unitName: string;
  expectedQty: string;
  countedQty: string | null;
  varianceQty: string | null;
  appliedDeltaQty: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export type StocktakeDetail = {
  id: string;
  name: string;
  scope: StocktakeScope;
  status: StocktakeStatus;
  notes: string | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lines: StocktakeDetailLine[];
};

export type StocktakeStaleWarningPayload = {
  items: Array<{
    lineId: string;
    itemId: string;
    itemName: string;
    unitName: string;
    expectedQty: string;
    currentQty: string;
    countedQty: string;
  }>;
};
