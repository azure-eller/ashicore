import "server-only";

import type { AccountingProvider } from "@/lib/accounting/constants";

export type ExternalPurchaseOrderLine = {
  lineItemID: string | null;
  itemCode: string | null;
  description: string | null;
  quantity: number | null;
  unitAmount: number | null;
  accountCode: string | null;
  taxType: string | null;
};

export type ExternalPurchaseOrderDocument = {
  id: string;
  number: string;
  status: string;
  supplierContactId: string | null;
  supplierName: string;
  date: string | null;
  deliveryDate: string | null;
  deliveryAddress: string | null;
  total: number | null;
  updatedAt: Date | null;
  lines: ExternalPurchaseOrderLine[];
};

export type ExternalPurchaseOrderFetchResult = {
  tenantId: string;
  tenantName: string;
  purchaseOrders: ExternalPurchaseOrderDocument[];
};

export type AccountingConnector = {
  provider: AccountingProvider;
  displayName: string;
  fetchOpenPurchaseOrders(
    orgId: string
  ): Promise<ExternalPurchaseOrderFetchResult>;
  extractErrorMessage(error: unknown): string;
  redactError(error: unknown): unknown;
};
