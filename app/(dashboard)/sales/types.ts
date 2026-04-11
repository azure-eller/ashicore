import type { SalesOrderStatus } from "@/lib/schemas/sales-orders";

export type PricingSourceType = "base_price" | "schedule_break";

export type CustomerRow = {
  id: string;
  name: string;
  customerCategoryId: string | null;
  customerCategoryName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CustomerOption = {
  id: string;
  name: string;
};

export type CustomerCategoryOption = {
  id: string;
  name: string;
};

export type CustomerCategoryRow = {
  id: string;
  name: string;
  description: string | null;
  customerCount: number;
  scheduleCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type PricingUnitOption = {
  id: string;
  name: string;
  size: string;
  uom: string;
  label: string;
};

export type PricingScheduleBreakRow = {
  id: string;
  minQuantity: string;
  maxQuantity: string | null;
  discountPercent: string;
  sortOrder: number;
};

export type PricingScheduleRow = {
  id: string;
  name: string;
  customerCategoryId: string | null;
  customerScopeLabel: string;
  unitDefinitionId: string;
  unitName: string;
  unitLabel: string;
  notes: string | null;
  breakCount: number;
  breakSummary: string;
  updatedAt: Date;
};

export type PricingScheduleEditData = {
  id: string;
  name: string;
  customerCategoryId: string | null;
  unitDefinitionId: string;
  notes: string | null;
  breaks: Array<{
    minQuantity: string;
    maxQuantity: string | null;
    discountPercent: string;
  }>;
};

export type SalesLinePricingResult = {
  baseUnitPrice: string | null;
  suggestedUnitPrice: string | null;
  pricingSourceType: PricingSourceType;
  pricingScheduleName: string | null;
  pricingBreakLabel: string | null;
  customerCategoryName: string | null;
};

export type SalesOrderItemOption = {
  id: string;
  itemType: "material" | "product";
  name: string;
  displayName: string;
  sku: string | null;
  unitName: string;
  defaultSellingPrice: string | null;
  stock: string;
  committedQty: string;
  expectedQty: string;
  safetyStock: string;
};

export type SalesOrderListRow = {
  id: string;
  orderNumber: string;
  customerName: string;
  status: SalesOrderStatus;
  requestedDate: string | null;
  fulfilledAt: Date | null;
  totalAmount: string;
  itemSummary: string;
  hasManufacturableLines: boolean;
  manufacturableLineCount: number;
  manufacturableDisabledReason: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SalesOrderDetailLine = {
  id: string;
  itemId: string;
  itemName: string;
  itemSku: string | null;
  unitName: string;
  quantity: string;
  unitPrice: string;
  suggestedUnitPrice: string | null;
  pricingSourceType: PricingSourceType | null;
  pricingScheduleName: string | null;
  pricingBreakLabel: string | null;
  isPriceOverridden: boolean;
  lineTotal: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  calcStock: string | null;
  potential: string | null;
};

export type SalesOrderDetail = {
  id: string;
  customerId: string;
  customerName: string;
  orderNumber: string;
  status: SalesOrderStatus;
  requestedDate: string | null;
  notes: string | null;
  fulfilledAt: Date | null;
  totalAmount: string;
  hasManufacturableLines: boolean;
  manufacturableLineCount: number;
  manufacturableDisabledReason: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lines: SalesOrderDetailLine[];
  linkedManufacturingOrders: Array<{
    id: string;
    orderNumber: string;
    productName: string;
    productSku: string | null;
    plannedQuantity: string;
    unitName: string;
    status: "draft" | "released" | "completed" | "cancelled";
  }>;
};

export type SalesOrderEditData = {
  id: string;
  customerId: string;
  status: Extract<SalesOrderStatus, "draft">;
  requestedDate: string | null;
  notes: string | null;
  lines: Array<{
    itemId: string;
    quantity: string;
    unitPrice: string;
    suggestedUnitPrice: string | null;
    pricingSourceType: PricingSourceType;
    pricingScheduleName: string | null;
    pricingBreakLabel: string | null;
    isPriceOverridden: boolean;
  }>;
};

export type OversellWarningProduct = {
  itemId: string;
  itemName: string;
  itemSku: string | null;
  unitName: string;
  inStock: number;
  committedQty: number;
  expectedQty: number;
  safetyStock: number;
  calculatedStock: number;
  addedQty: number;
  projectedCommittedQty: number;
  projectedCalculatedStock: number;
};

export type OversellWarningPayload = {
  products: OversellWarningProduct[];
};

export type BulkOversellWarningPayload = {
  orders: Array<{
    salesOrderId: string;
    salesOrderNumber: string;
    products: OversellWarningProduct[];
  }>;
};
