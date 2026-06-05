import type {
  PurchaseOrderAdditionalCostDistributionMethod,
  PurchaseOrderAdditionalCostType,
  PurchaseOrderStatus,
} from "@/lib/schemas/purchase-orders";

export type SupplierRow = {
  id: string;
  name: string;
  code: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  billingLine1: string | null;
  billingLine2: string | null;
  billingCity: string | null;
  billingRegion: string | null;
  billingPostcode: string | null;
  billingCountry: string | null;
  xeroContactId: string | null;
  paymentTerms: string | null;
  notes: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SupplierOption = {
  id: string;
  name: string;
  code: string | null;
  email?: string | null;
};

export type PurchaseOrderMaterialOption = {
  id: string;
  itemType: "material" | "product";
  name: string;
  sku: string | null;
  stockingUnitName: string;
  purchaseUnitName: string | null;
  purchaseToStockFactor: string | null;
  defaultPurchasePrice: string | null;
  currentStockUnitCost: string | null;
  accountingPurchaseAccountCode: string | null;
};

export type PurchaseOrderListRow = {
  id: string;
  orderNumber: string;
  supplierName: string;
  supplierEmail: string | null;
  accountingPurchaseAccountCode: string | null;
  status: PurchaseOrderStatus;
  expectedDate: string | null;
  totalAmount: string;
  shippingCost: string;
  itemSummary: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  receivedAt: Date | null;
  purchaseBillStatus: "pending" | "pushed" | "failed" | null;
  purchaseBillError: string | null;
  purchaseBillExternalId: string | null;
  purchaseBillExternalNumber: string | null;
  purchaseBillPushedAt: Date | null;
  hasAdditionalCosts: boolean;
  additionalCostTotal: string;
  xeroPoEmailStatus: "sent" | "failed" | "skipped" | null;
  xeroPoEmailError: string | null;
  xeroPoEmailedAt: Date | null;
};

export type PurchaseOrderDetailLine = {
  id: string;
  itemId: string;
  itemName: string;
  itemSku: string | null;
  lotTrackingMode: "tracked" | "untracked";
  purchaseUnitName: string;
  stockingUnitName: string;
  purchaseToStockFactor: string;
  quantityOrdered: string;
  quantityReceived: string;
  quantityRemaining: string;
  stockQuantityOrdered: string;
  stockQuantityReceived: string;
  stockQuantityRemaining: string;
  unitCost: string;
  stockUnitCost: string;
  landedCost: string;
  taxRateId: string | null;
  taxRateName: string | null;
  taxRatePercent: string;
  accountingPurchaseAccountCode: string | null;
  shipAddressEntryId: string | null;
  shipContactName: string | null;
  shipContactPhone: string | null;
  shipLine1: string | null;
  shipLine2: string | null;
  shipCity: string | null;
  shipRegion: string | null;
  shipPostcode: string | null;
  shipCountry: string | null;
  shipDeliveryInstructions: string | null;
  lineSubtotal: string;
  lineTaxAmount: string;
  lineTotal: string;
  allocatedAdditionalCost: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export type PurchaseOrderAdditionalCost = {
  id: string;
  costType: PurchaseOrderAdditionalCostType;
  reference: string | null;
  distributionMethod: PurchaseOrderAdditionalCostDistributionMethod;
  accountingPurchaseAccountCode: string | null;
  amount: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export type PurchaseOrderAttachment = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedByName: string | null;
  createdAt: Date;
  syncStatus: "synced" | "failed" | null;
  syncError: string | null;
  syncedAt: Date | null;
};

export type PurchaseOrderDetail = {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierEmail: string | null;
  orderNumber: string;
  status: PurchaseOrderStatus;
  expectedDate: string | null;
  notes: string | null;
  accountingPurchaseAccountCode: string | null;
  shipLine1: string | null;
  shipLine2: string | null;
  shipCity: string | null;
  shipRegion: string | null;
  shipPostcode: string | null;
  shipCountry: string | null;
  shippingCost: string;
  subtotalAmount: string;
  taxAmount: string;
  totalAmount: string;
  orderedAt: Date | null;
  receivedAt: Date | null;
  cancelledAt: Date | null;
  xeroPurchaseOrderId: string | null;
  xeroPurchaseOrderNumber: string | null;
  xeroPushStatus: "pending" | "pushed" | "failed" | null;
  xeroPushError: string | null;
  xeroPushedAt: Date | null;
  xeroPushPayloadHash: string | null;
  xeroLastPushAttemptAt: Date | null;
  xeroRetryCount: number;
  xeroPoEmailStatus: "sent" | "failed" | "skipped" | null;
  xeroPoEmailError: string | null;
  xeroPoEmailedAt: Date | null;
  purchaseBillExternalId: string | null;
  purchaseBillExternalNumber: string | null;
  purchaseBillStatus: "pending" | "pushed" | "failed" | null;
  purchaseBillError: string | null;
  purchaseBillPushedAt: Date | null;
  purchaseBillPayloadSnapshot: Record<string, unknown> | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lines: PurchaseOrderDetailLine[];
  taxRates: PurchaseOrderTaxRateOption[];
  defaultTaxRateId: string | null;
  additionalCosts: PurchaseOrderAdditionalCost[];
  attachments: PurchaseOrderAttachment[];
};

export type PurchaseOrderTaxRateOption = {
  id: string;
  name: string;
  ratePercent: string;
};

export type PurchaseOrderEditData = {
  id: string;
  orderNumber: string;
  supplierId: string;
  supplierEmail: string | null;
  status: PurchaseOrderStatus;
  expectedDate: string | null;
  notes: string | null;
  accountingPurchaseAccountCode: string | null;
  shipLine1: string | null;
  shipLine2: string | null;
  shipCity: string | null;
  shipRegion: string | null;
  shipPostcode: string | null;
  shipCountry: string | null;
  shippingCost: string;
  purchaseBillExternalId: string | null;
  purchaseBillExternalNumber: string | null;
  purchaseBillStatus: "pending" | "pushed" | "failed" | null;
  purchaseBillError: string | null;
  xeroPoEmailStatus: "sent" | "failed" | "skipped" | null;
  xeroPoEmailError: string | null;
  xeroPoEmailedAt: Date | null;
  lines: Array<{
    id: string;
    itemId: string;
    quantityOrdered: string;
    quantityReceived: string;
    stockQuantityReceived: string;
    unitCost: string;
    taxRateId: string | null;
    accountingPurchaseAccountCode: string | null;
    shipAddressEntryId: string | null;
    shipContactName: string | null;
    shipContactPhone: string | null;
    shipLine1: string | null;
    shipLine2: string | null;
    shipCity: string | null;
    shipRegion: string | null;
    shipPostcode: string | null;
    shipCountry: string | null;
    shipDeliveryInstructions: string | null;
  }>;
  taxRates: PurchaseOrderTaxRateOption[];
  defaultTaxRateId: string | null;
  additionalCosts: Array<{
    id: string;
    costType: PurchaseOrderAdditionalCostType;
    reference: string | null;
    distributionMethod: PurchaseOrderAdditionalCostDistributionMethod;
    accountingPurchaseAccountCode: string | null;
    amount: string;
  }>;
  attachments: PurchaseOrderAttachment[];
};
