import type { PurchaseOrderStatus } from "@/lib/schemas/purchase-orders";

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
};

export type PurchaseOrderMaterialOption = {
  id: string;
  name: string;
  sku: string | null;
  stockingUnitName: string;
  purchaseUnitName: string | null;
  purchaseToStockFactor: string | null;
  defaultPurchasePrice: string | null;
  currentStockUnitCost: string | null;
};

export type PurchaseOrderListRow = {
  id: string;
  orderNumber: string;
  supplierName: string;
  status: PurchaseOrderStatus;
  expectedDate: string | null;
  totalAmount: string;
  itemSummary: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  receivedAt: Date | null;
};

export type PurchaseOrderDetailLine = {
  id: string;
  itemId: string;
  itemName: string;
  itemSku: string | null;
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
  lineTotal: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export type PurchaseOrderDetail = {
  id: string;
  supplierId: string;
  supplierName: string;
  orderNumber: string;
  status: PurchaseOrderStatus;
  expectedDate: string | null;
  notes: string | null;
  totalAmount: string;
  orderedAt: Date | null;
  receivedAt: Date | null;
  cancelledAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lines: PurchaseOrderDetailLine[];
};

export type PurchaseOrderEditData = {
  id: string;
  supplierId: string;
  status: Extract<PurchaseOrderStatus, "draft">;
  expectedDate: string | null;
  notes: string | null;
  lines: Array<{
    itemId: string;
    quantityOrdered: string;
    unitCost: string;
  }>;
};
