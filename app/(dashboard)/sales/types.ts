import type { SalesOrderStatus } from "@/lib/schemas/sales-orders";

export type CustomerRow = {
  id: string;
  name: string;
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

export type SalesOrderProductOption = {
  id: string;
  name: string;
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
  totalAmount: string;
  itemSummary: string;
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
  lineTotal: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export type SalesOrderDetail = {
  id: string;
  customerId: string;
  customerName: string;
  orderNumber: string;
  status: SalesOrderStatus;
  requestedDate: string | null;
  notes: string | null;
  totalAmount: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lines: SalesOrderDetailLine[];
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
