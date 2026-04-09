import type { ManufacturingOrderStatus } from "@/lib/schemas/manufacturing-orders";

export type ManufacturingProductOption = {
  id: string;
  name: string;
  sku: string | null;
  unitName: string;
  manufacturingMode: string;
  expectedBatchYield: string | null;
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
  status: "draft" | "confirmed";
};

export type ManufacturingSalesOrderOption = {
  id: string;
  orderNumber: string;
  customerName: string;
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
    | "existing_active_mo"
    | null;
  skipMessage: string | null;
};

export type ManufacturingSalesOrderPreview = {
  salesOrderId: string;
  salesOrderNumber: string;
  customerName: string;
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
    reason: "non_product" | "inactive_product" | "no_active_bom" | "existing_active_mo";
  }>;
};

export type ManufacturingReleaseWarningIngredient = {
  itemId: string;
  itemName: string;
  unitName: string;
  needed: number;
  available: number;
  shortage: number;
};

export type ManufacturingReleaseWarningPayload = {
  ingredients: ManufacturingReleaseWarningIngredient[];
};

export type ManufacturingOrderListRow = {
  id: string;
  orderNumber: string;
  productName: string;
  productSku: string | null;
  salesOrderNumber: string | null;
  plannedQuantity: string;
  actualQuantity: string | null;
  unitName: string;
  plannedDate: string | null;
  status: ManufacturingOrderStatus;
  manufacturingMode: string;
  numberOfBatches: number | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

export type ManufacturingOrderIngredientDetail = {
  id: string;
  itemId: string;
  itemName: string;
  itemSku: string | null;
  itemType: string;
  unitName: string;
  quantityPerUnit: string;
  plannedQuantity: string;
  actualQuantity: string | null;
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
  plannedQuantity: string;
  actualQuantity: string | null;
  plannedDate: string | null;
  actualMaterialCost: string | null;
  actualCostPerUnit: string | null;
  notes: string | null;
  releasedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  ingredients: ManufacturingOrderIngredientDetail[];
  producedLot: {
    lotId: string;
    lotNumber: string;
    quantity: string;
    costPerUnit: string | null;
  } | null;
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
  plannedDate: string | null;
  notes: string | null;
  ingredients: Array<{
    itemId: string;
    itemName: string;
    itemSku: string | null;
    itemType: string;
    unitName: string;
    quantityPerUnit: string;
  }>;
};
