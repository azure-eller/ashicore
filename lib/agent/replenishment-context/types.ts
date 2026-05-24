export type ReplenishmentContextView = "summary" | "detail";

export type ReplenishmentLeadTimeSource =
  | "recent_receipts"
  | "item_default"
  | "unknown";

export type ReplenishmentSummaryRow = {
  itemId: string;
  item: string;
  sku?: string;
  units: string;
  available: number;
  used7d: number;
  used30d: number;
  used90d: number;
  required7d: number;
  required14d: number;
  required30d: number;
  incoming30dStockEquivalent: number;
  nextIncomingDays: number | null;
  typicalLeadTimeDays: number | null;
  daysSinceLastUsed: number | null;
};

export type ReplenishmentSummaryContext = {
  view: "summary";
  returnedCount: number;
  totalCandidateCount: number;
  truncated: boolean;
  items: ReplenishmentSummaryRow[];
};

export type ReplenishmentDetailContext = {
  view: "detail";
  itemId: string;
  item: string;
  sku?: string;
  units: {
    stock: string;
    purchase: string;
    conversion: string;
  };
  availableStock: number;
  usedStockUnits: {
    last7d: number;
    last30d: number;
    last90d: number;
  };
  requiredStockUnits: {
    next7d: number;
    next14d: number;
    next30d: number;
  };
  requiredDemandSources: {
    manufacturingIngredientDemand: number;
    directSalesDemand: number;
  };
  incomingPurchases: Array<{
    purchaseOrderId: string;
    purchaseOrderLineId: string;
    orderNumber: string;
    supplierName: string;
    purchaseQty: number;
    purchaseUnit: string;
    stockQtyEquivalent: number;
    expectedInDays: number | null;
  }>;
  leadTimeDays: {
    typical: number | null;
    source: ReplenishmentLeadTimeSource;
    recentSamples: number[];
  };
  purchaseRules?: {
    minimum?: string;
  };
  daysSinceLastUsed: number | null;
};

export type ReplenishmentContext =
  | ReplenishmentSummaryContext
  | ReplenishmentDetailContext;
