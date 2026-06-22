import type {
  StocktakeScope,
  StocktakeScopeItemType,
  StocktakeStatus,
} from "@/lib/schemas/stocktakes";
import type { LotTrackingMode } from "@/lib/inventory/lot-tracking";

export type ItemType = StocktakeScopeItemType;

export type StocktakeScopeOption = {
  value: StocktakeScope;
  label: string;
};

export type StocktakeScopeOptionGroup = {
  label: string;
  options: StocktakeScopeOption[];
};

export type StocktakePreviewItem = {
  id: string;
  name: string;
  displayName: string;
  searchText: string;
  sku: string | null;
  itemType: ItemType;
  stocktakeType: StocktakeScopeItemType;
  lotTrackingMode: LotTrackingMode;
  category: string | null;
  unitName: string;
  currentQty: string;
};

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

export type StocktakeDetailLotLine = {
  id: string;
  lotId: string | null;
  isFound: boolean;
  lotNumber: string;
  expectedQty: string;
  countedQty: string | null;
  varianceQty: string | null;
  appliedDeltaQty: string | null;
  notes: string | null;
  receivedAt: Date;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export type StocktakeDetailLine = {
  id: string;
  itemId: string;
  itemName: string;
  itemSku: string | null;
  itemType: ItemType;
  lotTrackingMode: LotTrackingMode;
  category: string | null;
  unitName: string;
  expectedQty: string;
  countedQty: string | null;
  varianceQty: string | null;
  appliedDeltaQty: string | null;
  notes: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  lots: StocktakeDetailLotLine[];
};

export type StocktakeDetail = {
  id: string;
  name: string;
  scope: StocktakeScope;
  status: StocktakeStatus;
  locationId: string | null;
  notes: string | null;
  reason: string | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lines: StocktakeDetailLine[];
};

export type StocktakeStaleWarningPayload = {
  items: Array<{
    lineId: string;
    lotLineId?: string | null;
    itemId: string;
    itemName: string;
    lotNumber?: string | null;
    unitName: string;
    expectedQty: string;
    currentQty: string;
    countedQty: string;
  }>;
};

export type StocktakeCompletionPreview = {
  id: string;
  name: string;
  status: StocktakeStatus;
  lines: Array<{
    lineId: string;
    itemId: string;
    itemName: string;
    itemSku: string | null;
    category: string | null;
    unitName: string;
    expectedQty: string;
    currentQty: string;
    countedQty: string;
    varianceQty: string;
    notes: string | null;
    lots: Array<{
      lotLineId: string;
      lotId: string | null;
      isFound: boolean;
      lotNumber: string;
      expectedQty: string;
      currentQty: string;
      countedQty: string;
      varianceQty: string;
      notes: string | null;
    }>;
  }>;
};

export type CloneStocktakeResult = {
  id: string;
  skippedItems: Array<{
    itemName: string;
    itemSku: string | null;
  }>;
};
