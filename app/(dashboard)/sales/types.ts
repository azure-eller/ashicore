import type {
  SalesOrderStatus,
  SalesShipmentCostStatus,
  SalesShipmentCostType,
} from "@/lib/schemas/sales-orders";
import type {
  CustomerAccountPriority as CustomerPriority,
  CustomerAccountState as CustomerState,
} from "@/lib/schemas/customers";
import type {
  CUSTOMER_CONTACT_ROLE_KEYS,
  CUSTOMER_CORRESPONDENCE_TYPES,
  CUSTOMER_PROJECT_STATUSES,
} from "@/lib/schemas/customer-crm";

export type PricingSourceType = "base_price" | "schedule_break";

export type CustomerRow = {
  id: string;
  name: string;
  customerCategoryId: string | null;
  customerCategoryName: string | null;
  accountState: CustomerState;
  accountPriority: CustomerPriority;
  openOrderCount: number;
  openOrderValue: string;
  latestOrderDate: string | null;
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

export type CustomerContactRole = (typeof CUSTOMER_CONTACT_ROLE_KEYS)[number];
export type CustomerCorrespondenceType =
  (typeof CUSTOMER_CORRESPONDENCE_TYPES)[number];
export type CustomerProjectStatus =
  (typeof CUSTOMER_PROJECT_STATUSES)[number];

export type CustomerContactRow = {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  roles: CustomerContactRole[];
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CustomerCorrespondenceAttendeeRow = {
  id: string;
  contactId: string | null;
  contactName: string;
};

export type CustomerCorrespondenceRow = {
  id: string;
  type: CustomerCorrespondenceType;
  occurredAt: Date;
  title: string | null;
  body: string;
  createdByUserId: string;
  createdByName: string | null;
  attendees: CustomerCorrespondenceAttendeeRow[];
  createdAt: Date;
  updatedAt: Date;
};

export type CustomerProjectFileRow = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedByUserId: string;
  uploadedByName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CustomerProjectRow = {
  id: string;
  name: string;
  status: CustomerProjectStatus;
  startDate: string | null;
  targetEndDate: string | null;
  summary: string | null;
  files: CustomerProjectFileRow[];
  salesOrders: CustomerLinkedSalesOrderRow[];
  createdAt: Date;
  updatedAt: Date;
};

export type CustomerDetailData = CustomerRow & {
  contacts: CustomerContactRow[];
  correspondence: CustomerCorrespondenceRow[];
  projects: CustomerProjectRow[];
  salesOrders: CustomerLinkedSalesOrderRow[];
};

export type CustomerProjectOption = {
  id: string;
  name: string;
  status: CustomerProjectStatus;
};

export type CustomerOption = {
  id: string;
  name: string;
  projects: CustomerProjectOption[];
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

export type CustomerLinkedSalesOrderRow = {
  id: string;
  orderNumber: string;
  status: SalesOrderStatus;
  orderDate: string;
  shipDate: string | null;
  requestedDate: string | null;
  totalAmount: string;
  customerProjectId: string | null;
  customerProjectName: string | null;
  deletedAt: Date | null;
  createdAt: Date;
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
  id?: string;
  itemId: string;
  masterName: string;
  attrs: string[];
  quantity: string;
  shippedQuantity?: string;
  remainingQty?: string;
  allocatedQty?: string;
  shortQty?: string;
  sourceSummary?: string;
  allocationStatus?: SalesAllocationLineSummary["status"];
  unitName: string;
};

export type SalesOrderListShipment = {
  id: string;
  shipmentNumber: string;
  sequence: number;
  status: "draft" | "shipped" | "cancelled";
  fulfillmentType: "delivery" | "pickup";
  scheduledDate: string | null;
  shippedAt: Date | null;
  totalAmount: string;
  lineCount: number;
};

export type SalesAllocationCoverageKind = "explicit" | "implicit";
export type SalesAllocationSourceType = "stock_pool" | "lot" | "manufacturing_order";

export type SalesAllocationLineSummary = {
  salesOrderLineId: string;
  itemId: string;
  allocatedQty: string;
  shortQty: string;
  sourceSummary: string;
  status: "ready" | "waiting_production" | "partial" | "short";
  sources: Array<{
    sourceType: SalesAllocationSourceType;
    sourceId: string | null;
    label: string;
    quantity: string;
    coverageKind: SalesAllocationCoverageKind;
  }>;
};

export type SalesOrderFulfillmentSummary = {
  remainingQty: string;
  allocatedQty: string;
  shortQty: string;
  productionAllocatedQty: string;
  label: string;
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
  customerId: string;
  customerName: string;
  customerEmail: string | null;
  customerProjectId: string | null;
  customerProjectName: string | null;
  notes: string | null;
  status: SalesOrderStatus;
  orderDate: string;
  shipDate: string | null;
  requestedDate: string | null;
  shippedAt: Date | null;
  totalAmount: string;
  itemSummary: string;
  lines: SalesOrderListLine[];
  shipments: SalesOrderListShipment[];
  fulfillmentSummary: SalesOrderFulfillmentSummary;
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
  onHandQty: string | null;
  availableQty: string | null;
  allocatedQty: string;
  potential: string | null;
  shortQty: string;
  sourceSummary: string;
  allocationStatus: SalesAllocationLineSummary["status"];
  allocationSources: SalesAllocationLineSummary["sources"];
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
  xeroInvoiceId: string | null;
  xeroInvoiceNumber: string | null;
  xeroPushStatus: "pending" | "pushed" | "failed" | null;
  xeroPushError: string | null;
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
  customerProjectId: string | null;
  customerProjectName: string | null;
  orderNumber: string;
  status: SalesOrderStatus;
  orderDate: string;
  shipDate: string | null;
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
  fulfillmentSummary: SalesOrderFulfillmentSummary;
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
    plannedDate: string | null;
    priorityRank: number | null;
    status: "draft" | "released" | "completed" | "cancelled";
  }>;
};

export type SalesAllocationSource = {
  sourceType: SalesAllocationSourceType;
  sourceId: string | null;
  label: string;
  status: "available" | "draft" | "released" | "completed";
  date: string | null;
  priorityRank: number | null;
  lotNumber?: string | null;
  totalQty: string;
  allocatedQty: string;
  freeQty: string;
  currentTargetQty: string;
  maxQty: string;
  canAllocate: boolean;
};

export type SalesAllocationDemandRow = {
  salesOrderLineId: string;
  salesOrderId: string;
  orderNumber: string;
  orderStatus: SalesOrderStatus;
  customerName: string;
  shipDate: string | null;
  itemId: string;
  itemName: string;
  unitName: string;
  orderedQty: string;
  shippedQty: string;
  cancelledQty: string;
  remainingQty: string;
  allocatedQty: string;
  shortQty: string;
  sourceSummary: string;
  sources: Array<{
    sourceType: SalesAllocationSourceType;
    sourceId: string | null;
    label: string;
    quantity: string;
    coverageKind: SalesAllocationCoverageKind;
  }>;
  isTarget: boolean;
};

export type SalesAllocationSheetData = {
  targetLine: SalesAllocationDemandRow & {
    allocationManagedAt: Date | null;
  };
  editableAllocations: Array<{
    sourceType: SalesAllocationSourceType;
    sourceId: string | null;
    sourceLabel: string;
    quantity: string;
    freeQuantity: string;
    maxQuantity: string;
    coverageKind: SalesAllocationCoverageKind;
  }>;
  supplySources: SalesAllocationSource[];
  demandRows: SalesAllocationDemandRow[];
  uncoveredDemandQty: string;
};

export type SalesShippingQueueRow = {
  salesOrderId: string;
  orderNumber: string;
  customerName: string;
  status: Extract<SalesOrderStatus, "confirmed" | "partially_shipped">;
  shipDate: string | null;
  deliveryDate: string | null;
  requestedDate: string | null;
  notes: string | null;
  shipLine1: string | null;
  shipLine2: string | null;
  shipCity: string | null;
  shipRegion: string | null;
  shipPostcode: string | null;
  shipCountry: string | null;
  activeDraftShipmentId: string | null;
  recommendedShipmentId: string | null;
  shippingReadiness: SalesShippingReadiness;
  lines: SalesOrderDetailLine[];
  shipments: SalesShipmentRow[];
  openManufacturingOrders: SalesOrderDetail["linkedManufacturingOrders"];
};

export type SalesOrderEditData = {
  id: string;
  customerId: string;
  customerProjectId: string | null;
  orderNumber: string;
  status: Extract<SalesOrderStatus, "draft" | "confirmed">;
  orderDate: string;
  shipDate: string | null;
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

export type DraftAllocationTakeoverWarningPayload = {
  allocations: Array<{
    salesOrderId: string;
    salesOrderLineId: string;
    orderNumber: string;
    customerName: string;
    itemId: string;
    itemName: string;
    unitName: string;
    quantity: number;
  }>;
};
