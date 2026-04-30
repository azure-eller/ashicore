import type {
  SalesOrderStatus,
  SalesShipmentCostStatus,
  SalesShipmentCostType,
} from "@/lib/schemas/sales-orders";

export type PricingSourceType = "base_price" | "schedule_break";

export type CustomerRow = {
  id: string;
  name: string;
  customerCategoryId: string | null;
  customerCategoryName: string | null;
  email: string | null;
  phone: string | null;
  billingLine1: string | null;
  billingLine2: string | null;
  billingCity: string | null;
  billingRegion: string | null;
  billingPostcode: string | null;
  billingCountry: string | null;
  shipLine1: string | null;
  shipLine2: string | null;
  shipCity: string | null;
  shipRegion: string | null;
  shipPostcode: string | null;
  shipCountry: string | null;
  xeroContactId: string | null;
  notes: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CustomerOption = {
  id: string;
  name: string;
  billingLine1: string | null;
  billingLine2: string | null;
  billingCity: string | null;
  billingRegion: string | null;
  billingPostcode: string | null;
  billingCountry: string | null;
  shipLine1: string | null;
  shipLine2: string | null;
  shipCity: string | null;
  shipRegion: string | null;
  shipPostcode: string | null;
  shipCountry: string | null;
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
  estimatedUnitCost: string | null;
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
  estimatedUnitCost: string | null;
  stock: string;
  committedQty: string;
  demandQty: string;
  shortageQty: string;
  availableQty: string;
  expectedQty: string;
  safetyStock: string;
};

export type SalesOrderListLine = {
  masterName: string;
  attrs: string[];
  quantity: string;
  unitName: string;
};

export type SalesShippingReadinessState =
  | "not_confirmed"
  | "needs_manufacturing"
  | "in_production"
  | "insufficient_stock"
  | "ready"
  | "shipped"
  | "cancelled";

export type SalesShippingReadiness = {
  state: SalesShippingReadinessState;
  message: string;
  blockers: string[];
};

export type SalesOrderListRow = {
  id: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string | null;
  status: SalesOrderStatus;
  requestedDate: string | null;
  shippedAt: Date | null;
  totalAmount: string;
  itemSummary: string;
  lines: SalesOrderListLine[];
  hasManufacturableLines: boolean;
  manufacturableLineCount: number;
  manufacturableDisabledReason: string | null;
  openManufacturingOrderCount: number;
  shippingReadiness: SalesShippingReadiness;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SalesOrderDetailLine = {
  id: string;
  itemId: string;
  itemName: string;
  masterName: string;
  attrs: string[];
  itemSku: string | null;
  unitName: string;
  quantity: string;
  shippedQuantity: string;
  plannedQuantity: string;
  cancelledQuantity: string;
  remainingQuantity: string;
  unplannedRemainingQuantity: string;
  unitPrice: string;
  suggestedUnitPrice: string | null;
  pricingSourceType: PricingSourceType | null;
  pricingScheduleName: string | null;
  pricingBreakLabel: string | null;
  isPriceOverridden: boolean;
  lineTotal: string;
  estimatedUnitCost: string | null;
  estimatedCogs: string | null;
  estimatedGrossProfit: string | null;
  estimatedMarginPercent: string | null;
  actualUnitCost: string | null;
  actualCogs: string | null;
  actualGrossProfit: string | null;
  actualMarginPercent: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  calcStock: string | null;
  potential: string | null;
};

export type SalesShipmentLine = {
  id: string;
  salesOrderLineId: string;
  itemId: string;
  itemName: string;
  itemSku: string | null;
  unitName: string;
  quantity: string;
  sortOrder: number;
};

export type SalesMarginStatus = "estimated" | "actual" | "mixed" | "unknown";

export type SalesMarginSummary = {
  productRevenue: string;
  freightRecovery: string;
  productCogs: string | null;
  shipmentCosts: string;
  contributionMargin: string | null;
  marginPercent: string | null;
  costStatus: SalesMarginStatus;
};

export type SalesShipmentCostRow = {
  id: string;
  costType: SalesShipmentCostType;
  costStatus: SalesShipmentCostStatus;
  amount: string;
  vendorName: string | null;
  referenceNumber: string | null;
  incurredDate: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SalesShipmentRow = {
  id: string;
  shipmentNumber: string;
  sequence: number;
  status: "draft" | "shipped" | "cancelled";
  fulfillmentType: "delivery" | "pickup";
  scheduledDate: string | null;
  shippedAt: Date | null;
  notes: string | null;
  customerFreightChargeAmount: string | null;
  lines: SalesShipmentLine[];
  costs: SalesShipmentCostRow[];
  marginSummary: SalesMarginSummary;
  createdAt: Date;
  updatedAt: Date;
};

export type SalesOrderDetail = {
  id: string;
  customerId: string;
  customerName: string;
  customerEmail: string | null;
  orderNumber: string;
  status: SalesOrderStatus;
  requestedDate: string | null;
  notes: string | null;
  shippedAt: Date | null;
  shipLine1: string | null;
  shipLine2: string | null;
  shipCity: string | null;
  shipRegion: string | null;
  shipPostcode: string | null;
  shipCountry: string | null;
  xeroInvoiceId: string | null;
  xeroInvoiceNumber: string | null;
  xeroPushStatus: "pending" | "pushed" | "failed" | null;
  xeroPushError: string | null;
  xeroPushedAt: Date | null;
  xeroPushPayloadHash: string | null;
  xeroLastPushAttemptAt: Date | null;
  xeroRetryCount: number;
  xeroEmailStatus: "sent" | "failed" | "skipped" | null;
  xeroEmailError: string | null;
  xeroEmailedAt: Date | null;
  totalAmount: string;
  hasManufacturableLines: boolean;
  manufacturableLineCount: number;
  manufacturableDisabledReason: string | null;
  shippingReadiness: SalesShippingReadiness;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lines: SalesOrderDetailLine[];
  shipments: SalesShipmentRow[];
  marginSummary: SalesMarginSummary;
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
  shipLine1: string | null;
  shipLine2: string | null;
  shipCity: string | null;
  shipRegion: string | null;
  shipPostcode: string | null;
  shipCountry: string | null;
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
  availableQty: number;
  committedQty: number;
  demandQty: number;
  shortageQty: number;
  expectedQty: number;
  safetyStock: number;
  calculatedStock: number;
  addedQty: number;
  projectedDemandQty: number;
  projectedShortageQty: number;
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
