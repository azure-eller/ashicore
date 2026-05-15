import "server-only";

import { ACCOUNTING_PROVIDER_QUICKBOOKS } from "@/lib/accounting/constants";
import {
  asDateString,
  cleanDate,
  cleanString,
  defaultRedactError,
} from "@/lib/accounting/providers/common";
import type {
  AccountingConnector,
  ExternalPurchaseOrderDocument,
} from "@/lib/accounting/providers/types";
import { getAuthedQuickBooksConnection, quickBooksRequest } from "./client";

type QuickBooksQueryResponse = {
  QueryResponse?: {
    PurchaseOrder?: Array<Record<string, unknown>>;
  };
};

function extractRefName(value: unknown, fallback: string) {
  if (!value || typeof value !== "object") return fallback;
  return cleanString((value as { name?: unknown }).name) ?? fallback;
}

function extractRefValue(value: unknown) {
  if (!value || typeof value !== "object") return null;
  return cleanString((value as { value?: unknown }).value);
}

function mapQuickBooksPurchaseOrder(
  raw: Record<string, unknown>
): ExternalPurchaseOrderDocument | null {
  const id = cleanString(raw.Id);
  const number = cleanString(raw.DocNumber, 32) ?? id?.slice(0, 32);
  const supplierRef = raw.VendorRef;
  const lineItems = Array.isArray(raw.Line) ? raw.Line : [];
  if (!id || !number) return null;

  return {
    id,
    number,
    status: cleanString(raw.POStatus, 30) ?? "OPEN",
    supplierContactId: extractRefValue(supplierRef),
    supplierName: extractRefName(supplierRef, "Imported supplier"),
    date: asDateString(raw.TxnDate),
    deliveryDate: asDateString(raw.DueDate),
    deliveryAddress: null,
    total:
      raw.TotalAmt != null && Number.isFinite(Number(raw.TotalAmt))
        ? Number(raw.TotalAmt)
        : null,
    updatedAt: cleanDate(
      (raw.MetaData as { LastUpdatedTime?: unknown } | undefined)?.LastUpdatedTime
    ),
    lines: lineItems
      .map((entry) => entry as Record<string, unknown>)
      .filter((line) => line.DetailType === "ItemBasedExpenseLineDetail")
      .map((line) => {
        const detail =
          (line.ItemBasedExpenseLineDetail as Record<string, unknown> | undefined) ??
          {};
        const itemRef = detail.ItemRef as Record<string, unknown> | undefined;
        const quantity = Number(detail.Qty);
        const unitAmount = Number(detail.UnitPrice);
        return {
          lineItemID: cleanString(line.Id),
          itemCode: cleanString(itemRef?.value, 100),
          description:
            cleanString(line.Description, 1000) ??
            cleanString(itemRef?.name, 1000),
          quantity: Number.isFinite(quantity) ? quantity : null,
          unitAmount: Number.isFinite(unitAmount) ? unitAmount : null,
          accountCode: null,
          taxType: extractRefValue(detail.TaxCodeRef),
        };
      }),
  };
}

export const quickBooksAccountingConnector: AccountingConnector = {
  provider: ACCOUNTING_PROVIDER_QUICKBOOKS,
  displayName: "QuickBooks",
  extractErrorMessage(error) {
    return error instanceof Error ? error.message : "QuickBooks request failed.";
  },
  redactError: defaultRedactError,
  async fetchOpenPurchaseOrders(orgId) {
    const authed = await getAuthedQuickBooksConnection(orgId);
    const data = await quickBooksRequest<QuickBooksQueryResponse>(
      orgId,
      `/query?query=${encodeURIComponent(
        "select * from PurchaseOrder where POStatus != 'Closed' order by TxnDate desc"
      )}`
    );
    const purchaseOrders =
      data.QueryResponse?.PurchaseOrder?.map(mapQuickBooksPurchaseOrder).filter(
        (order): order is ExternalPurchaseOrderDocument => order != null
      ) ?? [];
    const firstCompany = await quickBooksRequest<{
      QueryResponse?: { CompanyInfo?: Array<{ CompanyName?: string }> };
    }>(
      orgId,
      `/query?query=${encodeURIComponent("select * from CompanyInfo")}`
    ).catch(() => null);
    const authedCompanyName =
      firstCompany?.QueryResponse?.CompanyInfo?.[0]?.CompanyName ?? "QuickBooks";

    return {
      tenantId: authed.realmId,
      tenantName: authedCompanyName,
      purchaseOrders,
    };
  },
};
