export type PlanningType = "buy" | "make" | "buy_or_make" | "unknown";

export type SuggestedPlanningAction = "buy" | "make" | "review" | "none";

export type PlanningRecommendationType =
  | "create_purchase_order"
  | "create_manufacturing_order"
  | "review_item_setup"
  | "none";

export type PlanningReasonCode =
  | "sales_order_demand"
  | "safety_stock_demand"
  | "manufacturing_component_demand"
  | "bom_component_demand"
  | "open_purchase_supply"
  | "open_manufacturing_supply"
  | "inventory_available"
  | "reserved_stock"
  | "projected_shortage"
  | "no_shortage"
  | "buy_item"
  | "make_item"
  | "missing_supplier"
  | "ambiguous_supplier"
  | "missing_purchase_price"
  | "missing_bom"
  | "bom_cycle_detected"
  | "bom_depth_limit"
  | "stale_recommendation"
  | "duplicate_draft_action";

export type PlanningSourceRefType =
  | "item"
  | "sales_order"
  | "sales_order_line"
  | "safety_stock"
  | "purchase_order"
  | "purchase_order_line"
  | "manufacturing_order"
  | "manufacturing_order_ingredient"
  | "bom_revision"
  | "planning_recommendation";

export type PlanningSourceRef = {
  sourceType: PlanningSourceRefType;
  sourceId: string;
  label: string;
  itemId?: string;
  quantity?: string;
  date?: string | null;
  parentSourceId?: string | null;
};

export type PlanningWarning = {
  code: PlanningReasonCode;
  message: string;
  severity: "info" | "warning" | "error";
  itemId?: string;
  sourceRefs: PlanningSourceRef[];
};

export type PlanningAssumption = {
  code: string;
  description: string;
};

export type PlanningItemSummary = {
  id: string;
  name: string;
  sku: string | null;
  itemType: string;
  unitName: string | null;
};

export type DemandFactType =
  | "sales_order"
  | "safety_stock"
  | "manufacturing_component"
  | "bom_explosion";

export type DemandFact = {
  id: string;
  itemId: string;
  demandType: DemandFactType;
  quantity: string;
  requiredDate: string | null;
  reasonCodes: PlanningReasonCode[];
  sourceRefs: PlanningSourceRef[];
  parentItemId?: string;
  parentDemandFactId?: string;
  bomRevisionId?: string;
  explanation: string;
};

export type SupplyFactType =
  | "available_inventory"
  | "purchase_order"
  | "manufacturing_order";

export type SupplyFact = {
  id: string;
  itemId: string;
  supplyType: SupplyFactType;
  quantity: string;
  expectedDate: string | null;
  status: string;
  reasonCodes: PlanningReasonCode[];
  sourceRefs: PlanningSourceRef[];
  explanation: string;
};

export type InventoryFact = {
  itemId: string;
  onHandQuantity: string;
  reservedQuantity: string;
  availableQuantity: string;
  expectedQuantity: string;
  sourceRefs: PlanningSourceRef[];
};

export type BomRequirementFact = {
  id: string;
  parentItemId: string;
  componentItemId: string;
  bomRevisionId: string;
  parentDemandFactId: string;
  level: number;
  quantityPerParent: string;
  parentShortageQuantity: string;
  requiredQuantity: string;
  reasonCodes: PlanningReasonCode[];
  sourceRefs: PlanningSourceRef[];
};

export type CreatePurchaseOrderDraftActionPayload = {
  actionType: "create_purchase_order";
  inputHash: string;
  recommendationId: string;
  itemId: string;
  quantity: string;
  requiredDate: string | null;
  supplierId: string;
  unitCost: string;
  sourceRefs: PlanningSourceRef[];
};

export type CreateManufacturingOrderDraftActionPayload = {
  actionType: "create_manufacturing_order";
  inputHash: string;
  recommendationId: string;
  itemId: string;
  quantity: string;
  requiredDate: string | null;
  bomRevisionId: string;
  ingredients: Array<{
    itemId: string;
    quantityPerUnit: string;
  }>;
  sourceRefs: PlanningSourceRef[];
};

export type PlanningActionPayload =
  | CreatePurchaseOrderDraftActionPayload
  | CreateManufacturingOrderDraftActionPayload;

export type PlanningRecommendation = {
  id: string;
  recommendationType: PlanningRecommendationType;
  itemId: string;
  quantity: string;
  requiredDate: string | null;
  suggestedSupplierId: string | null;
  suggestedSupplierName: string | null;
  suggestedBomRevisionId: string | null;
  reasonCodes: PlanningReasonCode[];
  sourceRefs: PlanningSourceRef[];
  warnings: PlanningWarning[];
  actionPayload: PlanningActionPayload | null;
  explanation: string;
};

export type PlanningItemRow = {
  item: PlanningItemSummary;
  planningType: PlanningType;
  demandQuantity: string;
  availableStock: string;
  reservedQuantity: string;
  incomingPurchaseOrderQuantity: string;
  incomingManufacturingOrderQuantity: string;
  projectedQuantity: string;
  shortageQuantity: string;
  earliestRequiredDate: string | null;
  suggestedAction: SuggestedPlanningAction;
  reasonCodes: PlanningReasonCode[];
  sourceRefs: PlanningSourceRef[];
  explanationSummary: string;
  recommendationId: string | null;
};

export type PlanningSnapshot = {
  orgId: string;
  generatedAt: string;
  horizonStart: string | null;
  horizonEnd: string | null;
  inputHash: string;
  assumptions: PlanningAssumption[];
  rows: PlanningItemRow[];
  demandFacts: DemandFact[];
  supplyFacts: SupplyFact[];
  inventoryFacts: InventoryFact[];
  bomRequirementFacts: BomRequirementFact[];
  recommendations: PlanningRecommendation[];
  warnings: PlanningWarning[];
};
