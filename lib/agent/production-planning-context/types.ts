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
import type {
  AllocationDemandType,
  AllocationSourceType,
} from "@/lib/inventory/allocation/types";

export type AgentProductionPlanningContextOptions = {
  includePlanningFacts?: boolean;
  includeLots?: boolean;
};

export type AgentProductionSummary = {
  openSalesOrderCount: number;
  openSalesOrderLineCount: number;
  openManufacturingOrderCount: number;
  openPurchaseOrderCount: number;
  relevantItemCount: number;
  activeAllocationCount: number;
  recommendationCount: number;
  productionBlockerCount: number;
};

export type AgentAttentionQueueItem = {
  type:
    | "sales_order_shortage"
    | "production_needed"
    | "material_shortage"
    | "mo_unallocated"
    | "allocation_conflict"
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
    plannedShipmentQty: string;
    cancelledQty: string;
    openQty: string;
    allocatedQty: string;
    shortQty: string;
    productionStatus:
      | "available"
      | "allocated"
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
  outputAllocations: Array<{
    allocationId: string;
    demandType: AllocationDemandType;
    demandId: string;
    demandLabel: string;
    quantity: string;
  }>;
  ingredients: Array<{
    manufacturingOrderIngredientId: string;
    itemId: string;
    itemName: string;
    unitName: string | null;
    requiredQty: string;
    pickedQty: string;
    allocatedQty: string;
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
  unitName: string | null;
  onHandQty: string;
  /** Current usable on-hand after reservations; not projected future availability. */
  availableQty: string;
  reservedQty: string;
  expectedQty: string;
  /** Planning-derived net projected quantity after demand and open supply. */
  projectedQty: string;
  inventoryLotAllocatedQty: string;
  manufacturingOutputAllocatedQty: string;
  totalActiveAllocationQty: string;
  lots: Array<{
    lotId: string;
    lotCode: string | null;
    locationId: string | null;
    locationName: string | null;
    receivedDate: string | null;
    disposition: string;
    onHandQty: string;
    availableQty: string;
    allocatedQty: string;
  }>;
};

export type AgentAllocationContext = {
  allocationId: string;
  itemId: string;
  itemName: string;
  demandType: AllocationDemandType;
  demandId: string;
  demandLabel: string;
  sourceType: AllocationSourceType;
  sourceId: string;
  sourceLabel: string;
  quantity: string;
  status: "active";
};

export type AgentAllowedAction = {
  action: "read_production_planning_context";
  status: "allowed";
  description: string;
};

export type AgentProductionPlanningContext = {
  orgId: string;
  generatedAt: string;
  inputHash: string;
  summary: AgentProductionSummary;
  attentionQueue: AgentAttentionQueueItem[];
  salesOrders: AgentOpenSalesOrderContext[];
  manufacturingOrders: AgentOpenManufacturingOrderContext[];
  purchaseOrders: AgentOpenPurchaseOrderContext[];
  inventory: AgentInventoryContext[];
  allocations: AgentAllocationContext[];
  planning: {
    horizonStart: string | null;
    horizonEnd: string | null;
    assumptions: PlanningAssumption[];
    inputHash: string;
    rows: PlanningItemRow[];
    recommendations: PlanningRecommendation[];
    productionBlockers: ProductionBlockerFact[];
    demandFacts: DemandFact[];
    supplyFacts: SupplyFact[];
    inventoryFacts: InventoryFact[];
    bomRequirements: BomRequirementFact[];
    salesOrderProductionDemandPaths: ProductionDemandPath[];
    warnings: PlanningWarning[];
  };
  allowedNextActions: AgentAllowedAction[];
};
