import type {
  BomRequirementFact,
  DemandFact,
  InventoryFact,
  PlanningItemRow,
  PlanningRecommendation,
  PlanningAssumption,
  PlanningSourceRef,
  PlanningWarning,
  ProductionBlockerFact,
  ProductionDemandPath,
  SupplyFact,
} from "@/lib/planning/types";
export type AgentPlanningItemRow = Omit<
  PlanningItemRow,
  "unitCost" | "unitCostSource"
>;

export type AgentPlanningWarning = Omit<PlanningWarning, "sourceRefs"> & {
  sourceRefs: PlanningSourceRef[];
};

export type AgentPlanningRecommendation = Omit<
  PlanningRecommendation,
  "actionPayload" | "sourceRefs" | "warnings"
> & {
  sourceRefs: PlanningSourceRef[];
  warnings: AgentPlanningWarning[];
};

export type AgentProductionBlockerFact = Omit<
  ProductionBlockerFact,
  "sourceRefs"
> & {
  sourceRefs: PlanningSourceRef[];
};

export type AgentBomRequirementContext = Omit<
  BomRequirementFact,
  "quantityPerParent" | "sourceRefs"
> & {
  sourceRefs: PlanningSourceRef[];
};

export type AgentProductionPlanningContextOptions = {
  includePlanningFacts?: boolean;
  includeLots?: boolean;
};

export type AgentProductionPlanningResponseFormat = "markdown" | "json";

export type AgentProductionSummary = {
  openSalesOrderCount: number;
  openSalesOrderLineCount: number;
  openManufacturingOrderCount: number;
  openPurchaseOrderCount: number;
  relevantItemCount: number;
  coverageNeedCount: number;
  coverableNowCount: number;
  supplyRecommendationCount: number;
  makeRecommendationCount: number;
  buyRecommendationCount: number;
  reviewItemSetupCount: number;
  recommendationCount: number;
  productionBlockerCount: number;
};

export type AgentAttentionQueueItem = {
  type:
    | "sales_order_shortage"
    | "production_needed"
    | "material_shortage"
    | "coverage_shortage"
    | "missing_bom"
    | "purchase_needed"
    | "planning_warning";
  severity: "info" | "warning" | "urgent";
  label: string;
  sourceRefs: PlanningSourceRef[];
};

export type AgentOpenSalesOrderContext = {
  salesOrderId: string;
  orderNumber: string;
  customerName: string | null;
  status: string;
  orderDate: string | null;
  requiredDate: string | null;
  fulfillmentStatus: string;
  priorityRank: number | null;
  lines: Array<{
    salesOrderLineId: string;
    itemId: string;
    itemName: string;
    unitName: string | null;
    orderedQty: string;
    shippedQty: string;
    cancelledQty: string;
    openQty: string;
    coveredQty: string;
    shortQty: string;
    productionStatus:
      | "available"
      | "needs_make"
      | "blocked"
      | "unknown";
  }>;
};

export type AgentOpenManufacturingOrderContext = {
  manufacturingOrderId: string;
  orderNumber: string;
  status: string;
  itemId: string;
  itemName: string;
  unitName: string | null;
  plannedQty: string;
  completedQty: string;
  remainingQty: string;
  plannedDate: string | null;
  expectedOutputDate: string | null;
  priorityRank: number | null;
  salesOrderId: string | null;
  salesOrderLineId: string | null;
  ingredients: Array<{
    manufacturingOrderIngredientId: string;
    itemId: string;
    itemName: string;
    unitName: string | null;
    requiredQty: string;
    pickedQty: string;
    shortQty: string;
  }>;
};

export type AgentOpenPurchaseOrderContext = {
  purchaseOrderId: string;
  orderNumber: string;
  supplierId: string;
  supplierName: string;
  status: string;
  expectedDate: string | null;
  lines: Array<{
    purchaseOrderLineId: string;
    itemId: string;
    itemName: string;
    stockingUnitName: string | null;
    orderedQty: string;
    receivedQty: string;
    remainingQty: string;
  }>;
};

export type AgentInventoryContext = {
  itemId: string;
  itemName: string;
  lotTrackingMode: "tracked" | "untracked";
  unitName: string | null;
  onHandQty: string;
  /** Current usable on-hand after reservations; not projected future availability. */
  availableQty: string;
  reservedQty: string;
  expectedQty: string;
  /** Planning-derived net projected quantity after demand and open supply. */
  projectedQty: string;
  lots: Array<{
    lotId: string;
    lotCode: string | null;
    locationId: string | null;
    locationName: string | null;
    receivedDate: string | null;
    disposition: string;
    onHandQty: string;
    availableQty: string;
  }>;
};

export type AgentCoverageNeedContext = {
  demandType: "sales_order_line" | "manufacturing_order_ingredient";
  demandId: string;
  demandLabel: string;
  itemId: string;
  itemName: string;
  unitName: string | null;
  priorityRank: number | null;
  requiredDate: string | null;
  requiredQty: string;
  coveredQty: string;
  shortQty: string;
  coverageRankForItem: number;
  availableQty: string;
  availableQtyBeforeThisNeed: string;
  availableQtyAfterThisNeed: string;
  projectedQty: string;
  projectedQtyAfterThisNeed: string;
  readiness:
    | "covered_by_available_inventory"
    | "available_after_open_supply"
    | "create_supply"
    | "blocked"
    | "review";
  sourceRefs: PlanningSourceRef[];
};

export type AgentSupplyRecommendationContext = {
  recommendationId: string;
  recommendationType: AgentPlanningRecommendation["recommendationType"];
  itemId: string;
  itemName: string;
  unitName: string | null;
  quantity: string;
  requiredDate: string | null;
  latestStartDate: string | null;
  suggestedSupplierId: string | null;
  suggestedSupplierName: string | null;
  suggestedBomRevisionId: string | null;
  reasonCodes: AgentPlanningRecommendation["reasonCodes"];
  warnings: AgentPlanningWarning[];
  explanation: string;
  sourceRefs: PlanningSourceRef[];
};

export type AgentDecisionQueueItem = {
  decisionType:
    | "cover_demand"
    | "create_manufacturing_order"
    | "create_purchase_order"
    | "review_item_setup"
    | "resolve_blocker";
  severity: "info" | "warning" | "urgent";
  label: string;
  itemId: string | null;
  itemName: string | null;
  unitName: string | null;
  quantity: string | null;
  requiredDate: string | null;
  demandType?: AgentCoverageNeedContext["demandType"];
  demandId?: string;
  recommendationId?: string;
  blockerId?: string;
  readiness?: AgentCoverageNeedContext["readiness"];
  reasonCodes?: AgentSupplyRecommendationContext["reasonCodes"];
  sourceRefs: PlanningSourceRef[];
};

export type AgentDecisionSupportContext = {
  decisionQueue: AgentDecisionQueueItem[];
  coverageNeeds: AgentCoverageNeedContext[];
  supplyRecommendations: AgentSupplyRecommendationContext[];
};

export type AgentTopLevelBomContext = {
  productItemId: string;
  productName: string;
  unitName: string | null;
  revisionId: string;
  revisionNumber: number;
  recipeBasis: "unit" | "batch";
  outputQuantity: string;
  components: Array<{
    bomRevisionComponentId: string;
    componentItemId: string;
    componentName: string;
    componentItemType: string;
    unitName: string | null;
    quantity: string;
    minimumLotAgeDays: number | null;
    constraints: Array<{
      type: string;
      label: string;
      minimumLotAgeDays: number | null;
    }>;
  }>;
};

export type AgentAllowedAction = {
  action: "read_production_planning_context";
  status: "allowed";
  description: string;
};

export type AgentProductionPlanningContext = {
  orgId: string;
  generatedAt: string;
  today: string;
  inputHash: string;
  summary: AgentProductionSummary;
  attentionQueue: AgentAttentionQueueItem[];
  salesOrders: AgentOpenSalesOrderContext[];
  manufacturingOrders: AgentOpenManufacturingOrderContext[];
  purchaseOrders: AgentOpenPurchaseOrderContext[];
  inventory: AgentInventoryContext[];
  decisionSupport: AgentDecisionSupportContext;
  topLevelBoms: AgentTopLevelBomContext[];
  planning: {
    horizonStart: string | null;
    horizonEnd: string | null;
    assumptions: PlanningAssumption[];
    inputHash: string;
    rows: AgentPlanningItemRow[];
    recommendations: AgentPlanningRecommendation[];
    productionBlockers: AgentProductionBlockerFact[];
    demandFacts: DemandFact[];
    supplyFacts: SupplyFact[];
    inventoryFacts: InventoryFact[];
    bomRequirements: AgentBomRequirementContext[];
    salesOrderProductionDemandPaths: ProductionDemandPath[];
    warnings: AgentPlanningWarning[];
  };
  allowedNextActions: AgentAllowedAction[];
};

export type AgentProductionRawContext = {
  generatedAt: string;
  openSalesOrders: Array<{
    salesOrderId: string;
    orderNumber: string;
    customerName: string | null;
    status: string;
    orderDate: string | null;
    shipDate: string | null;
    unplannedDemand: Array<{
      salesOrderLineId: string;
      itemId: string;
      itemName: string;
      unitName: string | null;
      orderedQty: string;
      shippedQty: string;
      cancelledQty: string;
      remainingToPlanQty: string;
      coveredQty: string;
      shortQty: string;
      productionStatus: AgentOpenSalesOrderContext["lines"][number]["productionStatus"];
    }>;
  }>;
  openManufacturingOrders: Array<{
    manufacturingOrderId: string;
    orderNumber: string;
    status: string;
    itemId: string;
    itemName: string;
    unitName: string | null;
    plannedQty: string;
    completedQty: string;
    remainingQty: string;
    plannedDate: string | null;
    expectedOutputDate: string | null;
    linkedSalesOrderId: string | null;
    linkedSalesOrderLineId: string | null;
  }>;
  productCounts: Array<{
    itemId: string;
    itemName: string;
    unitName: string | null;
    onHandQty: string;
    availableQty: string;
    reservedQty: string;
    expectedQty: string;
    openSalesDemandQty: string;
    openSalesCoveredQty: string;
    openSalesShortQty: string;
    openManufacturingSupplyQty: string;
    lotCounts: Array<{
      lotId: string;
      lotCode: string | null;
      receivedDate: string | null;
      ageDays: number | null;
      disposition: string;
      onHandQty: string;
      availableQty: string;
    }>;
  }>;
  productBoms: Array<{
    productItemId: string;
    productName: string;
    unitName: string | null;
    revisionId: string;
    revisionNumber: number;
    components: Array<{
      bomRevisionComponentId: string;
      componentItemId: string;
      componentName: string;
      componentItemType: string;
      componentUnitName: string | null;
      quantity: string;
      quantityMeaning: string;
      requirements: Array<
        | {
            type: "minimum_lot_age_days";
            days: number;
          }
        | {
            type: string;
          }
      >;
    }>;
  }>;
};
