import type {
  ManufacturingBatchStatus,
  ManufacturingOrderStatus,
  ManufacturingPickStatus,
} from "@/lib/schemas/manufacturing-orders";
import type { BomComponentConstraint } from "@/lib/bom/constraints";

export type ManufacturingProductOption = {
  id: string;
  name: string;
  displayName: string;
  sku: string | null;
  unitName: string;
  manufacturingMode: string;
  expectedBatchYield: string | null;
  typicalBatchSize: string | null;
  typicalGroupSize: string | null;
};

export type ManufacturingSalesLineOption = {
  salesOrderId: string;
  salesOrderLineId: string;
  salesOrderNumber: string;
  customerName: string;
  itemId: string;
  itemName: string;
  itemSku: string | null;
  quantity: string;
  unitName: string;
  status: "open";
};

export type ManufacturingSalesOrderOption = {
  id: string;
  orderNumber: string;
  customerName: string;
  shipDate: string | null;
  requestedDate: string | null;
  manufacturableLineCount: number;
  hasManufacturableLines: boolean;
  disabledReason: string | null;
};

export type ManufacturingSalesOrderPreviewLine = {
  salesOrderLineId: string;
  itemId: string;
  itemName: string;
  itemSku: string | null;
  quantity: string;
  unitName: string;
  status: "will_create" | "skipped";
  skipReason:
    | "non_product"
    | "inactive_product"
    | "no_active_bom"
    | "stock_on_hand"
    | "existing_active_mo"
    | null;
  skipMessage: string | null;
  groupRemainderRows: Array<{
    basisOutputQuantity: string | null;
    groupRemainderPolicy: string | null;
  }>;
};

export type ManufacturingSalesOrderPreview = {
  salesOrderId: string;
  salesOrderNumber: string;
  customerName: string;
  shipDate: string | null;
  requestedDate: string | null;
  manufacturableLineCount: number;
  hasManufacturableLines: boolean;
  disabledReason: string | null;
  lines: ManufacturingSalesOrderPreviewLine[];
};

export type ManufacturingOrdersFromSalesOrderResult = {
  created: Array<{
    salesOrderLineId: string;
    manufacturingOrderId: string;
    orderNumber: string;
  }>;
  skipped: Array<{
    salesOrderLineId: string;
    reason:
      | "non_product"
      | "inactive_product"
      | "no_active_bom"
      | "stock_on_hand"
      | "existing_active_mo";
  }>;
};

export type ManufacturingReleaseWarningIngredient = {
  itemId: string;
  itemName: string;
  unitName: string;
  needed: number;
  available: number;
  shortage: number;
  warningType?: "stock_shortage" | "requirement_violation";
  requirement?: string | null;
  nextEligibleDate?: string | null;
};

export type ManufacturingReleaseWarningPayload = {
  ingredients: ManufacturingReleaseWarningIngredient[];
};

export type ManufacturingPickProgressStatus =
  | "not_started"
  | "in_progress"
  | "picked";

export type ManufacturingIngredientReadiness =
  | "in_stock"
  | "expected"
  | "not_available"
  | "picking"
  | "picked";

export type ManufacturingOrderListRow = {
  id: string;
  orderNumber: string;
  productName: string;
  productSku: string | null;
  productCategory: string | null;
  productMasterName: string;
  productAttrs: string[];
  itemSpriteKind: string;
  itemSpriteColor: string;
  salesOrderNumber: string | null;
  salesCustomerName: string | null;
  priorityRank: number | null;
  requestedQuantity: string;
  plannedQuantity: string;
  actualQuantity: string | null;
  unitName: string;
  plannedDate: string | null;
  status: ManufacturingOrderStatus;
  manufacturingMode: string;
  numberOfBatches: number | null;
  pickProgressStatus: ManufacturingPickProgressStatus;
  pickProgressPercent: number;
  ingredientReadiness: ManufacturingIngredientReadiness;
  completedBatchCount: number;
  actionableBatchCount: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

export type ManufacturingExecutionQueueRow = {
  id: string;
  orderNumber: string;
  productName: string;
  productSku: string | null;
  productCategory: string | null;
  itemSpriteKind: string;
  itemSpriteColor: string;
  plannedQuantity: string;
  actualQuantity: string | null;
  unitName: string;
  plannedDate: string | null;
  priorityRank: number | null;
  manufacturingMode: string;
  pickProgressStatus: ManufacturingPickProgressStatus;
  nextBatchId: string | null;
  nextBatchNumber: number | null;
  completedBatchCount: number;
  totalBatchCount: number;
  actionLabel: string;
};

export type ManufacturingOrderIngredientDetail = {
  id: string;
  itemId: string;
  itemName: string;
  itemSku: string | null;
  itemType: string;
  unitName: string;
  quantityPerUnit: string;
  consumptionMode: string;
  basisOutputQuantity: string | null;
  batchScalingMode: string | null;
  groupRemainderPolicy: string | null;
  chosenGroupRemainderHandling: string | null;
  calculatedBatchCount: string | null;
  calculatedGroupCount: string | null;
  plannedQuantity: string;
  pickedQuantity: string;
  remainingQuantity: string;
  pickStatus: ManufacturingPickStatus;
  actualQuantity: string | null;
  actualCostTotal: string | null;
  sortOrder: number;
  constraints: BomComponentConstraint[];
  defaultItemId: string | null;
  defaultItemName: string | null;
  defaultItemSku: string | null;
  defaultUnitName: string | null;
  defaultQuantityPerUnit: string | null;
  alternates: Array<{
    itemId: string;
    itemName: string;
    itemSku: string | null;
    itemType: string;
    unitName: string;
    quantityFactor: string;
    sortOrder: number;
  }>;
};

export type ManufacturingOrderBatchDetail = {
  id: string;
  batchNumber: number;
  status: ManufacturingBatchStatus;
  plannedQuantity: string;
  actualQuantity: string | null;
  startedAt: Date | null;
  pickedAt: Date | null;
  completedAt: Date | null;
  lotId: string | null;
  lotNumber: string | null;
};

export type ManufacturingOrderProducedLot = {
  lotId: string;
  lotNumber: string;
  quantity: string;
  costPerUnit: string | null;
  batchId: string | null;
  batchNumber: number | null;
};

export type ManufacturingOrderOperationCostDetail = {
  id: string;
  operationName: string;
  resourceName: string;
  resourceType: string;
  costScalingMode: string;
  crewSize: string;
  plannedMinutes: string;
  plannedQuantityBasis: string | null;
  loadedCostPerHour: string;
  plannedCostTotal: string;
  actualCostTotal: string | null;
  sortOrder: number;
};

export type ManufacturingOrderDetail = {
  id: string;
  orderNumber: string;
  productId: string;
  productName: string;
  productSku: string | null;
  unitName: string;
  salesOrderId: string | null;
  salesOrderLineId: string | null;
  salesOrderNumber: string | null;
  salesCustomerName: string | null;
  status: ManufacturingOrderStatus;
  manufacturingMode: string;
  numberOfBatches: number | null;
  expectedBatchYield: string | null;
  priorityRank: number | null;
  requestedQuantity: string;
  plannedQuantity: string;
  actualQuantity: string | null;
  pickProgressStatus: ManufacturingPickProgressStatus;
  plannedDate: string | null;
  actualMaterialCost: string | null;
  actualOperationsCost: string | null;
  actualCostPerUnit: string | null;
  notes: string | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  ingredients: ManufacturingOrderIngredientDetail[];
  operationCosts: ManufacturingOrderOperationCostDetail[];
  batches: ManufacturingOrderBatchDetail[];
  producedLots: ManufacturingOrderProducedLot[];
};

export type ManufacturingExecutionBatch = {
  id: string;
  batchNumber: number;
  status: ManufacturingBatchStatus;
  plannedQuantity: string;
  actualQuantity: string | null;
  startedAt: Date | null;
  pickedAt: Date | null;
  completedAt: Date | null;
  lotId: string | null;
  lotNumber: string | null;
};

export type ManufacturingExecutionDetail = {
  id: string;
  orderNumber: string;
  productId: string;
  productName: string;
  productSku: string | null;
  unitName: string;
  status: ManufacturingOrderStatus;
  manufacturingMode: string;
  plannedQuantity: string;
  recordedOutputQuantity: string;
  actualQuantity: string | null;
  expectedBatchYield: string | null;
  numberOfBatches: number | null;
  pickProgressStatus: ManufacturingPickProgressStatus;
  salesOrderId: string | null;
  salesOrderNumber: string | null;
  salesCustomerName: string | null;
  plannedDate: string | null;
  priorityRank: number | null;
  notes: string | null;
  canComplete: boolean;
  currentBatchId: string | null;
  currentBatch: ManufacturingExecutionBatch | null;
  batches: ManufacturingExecutionBatch[];
  ingredients: ManufacturingOrderIngredientDetail[];
};

export type ManufacturingOrderEditData = {
  id: string;
  productId: string;
  productName: string;
  productSku: string | null;
  unitName: string;
  manufacturingMode: string;
  numberOfBatches: number | null;
  expectedBatchYield: string | null;
  salesOrderId: string | null;
  salesOrderLineId: string | null;
  salesOrderNumber: string | null;
  salesCustomerName: string | null;
  requestedQuantity: string;
  plannedQuantity: string;
  priorityRank: number | null;
  plannedDate: string | null;
  notes: string | null;
  ingredients: Array<{
    id: string;
    itemId: string;
    itemName: string;
    itemSku: string | null;
    itemType: string;
    unitName: string;
    quantityPerUnit: string;
    consumptionMode: string;
    basisOutputQuantity: string | null;
    batchScalingMode: string | null;
    groupRemainderPolicy: string | null;
    chosenGroupRemainderHandling: string | null;
    calculatedBatchCount: string | null;
    calculatedGroupCount: string | null;
    defaultItemId: string | null;
    defaultItemName: string | null;
    defaultItemSku: string | null;
    defaultUnitName: string | null;
    defaultQuantityPerUnit: string;
    alternates: Array<{
      itemId: string;
      itemName: string;
      itemSku: string | null;
      itemType: string;
      unitName: string;
      quantityFactor: string;
      sortOrder: number;
    }>;
  }>;
  lotAllocations: Array<{
    itemId: string;
    allocations: Array<{
      sourceId: string;
      quantity: string;
    }>;
  }>;
};
