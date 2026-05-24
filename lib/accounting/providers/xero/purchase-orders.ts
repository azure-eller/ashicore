import "server-only";

import { ACCOUNTING_PROVIDER_XERO } from "@/lib/accounting/constants";
import {
  asDateString,
  cleanDate,
  cleanString,
} from "@/lib/accounting/providers/common";
import type {
  AccountingConnector,
  ExternalPurchaseOrderDocument,
} from "@/lib/accounting/providers/types";
import { getAuthedXeroClient } from "@/lib/xero/client";
import {
  XeroError,
  extractXeroMessage,
  redactXeroError,
} from "@/lib/xero/errors";

const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const OPEN_XERO_PO_STATUSES = ["SUBMITTED", "AUTHORISED"] as const;

function mapXeroPurchaseOrder(
  raw: Record<string, unknown>
): ExternalPurchaseOrderDocument | null {
  const id = cleanString(raw.purchaseOrderID);
  const number = cleanString(raw.purchaseOrderNumber, 32) ?? id?.slice(0, 32);
  const status = cleanString(raw.status, 20);
  const contact = (raw.contact ?? {}) as Record<string, unknown>;
  const supplierName = cleanString(contact.name) ?? "Imported supplier";
  const lineItems = Array.isArray(raw.lineItems) ? raw.lineItems : [];

  if (!id || !number || !status) return null;

  return {
    id,
    number,
    status,
    supplierContactId: cleanString(contact.contactID),
    supplierName,
    date: asDateString(raw.date),
    deliveryDate: asDateString(raw.deliveryDate),
    deliveryAddress: cleanString(raw.deliveryAddress, 1000),
    total:
      raw.total != null && Number.isFinite(Number(raw.total))
        ? Number(raw.total)
        : null,
    updatedAt: cleanDate(raw.updatedDateUTC),
    lines: lineItems.map((entry) => {
      const line = entry as Record<string, unknown>;
      return {
        lineItemID: cleanString(line.lineItemID),
        itemCode: cleanString(line.itemCode, 100),
        description: cleanString(line.description, 1000),
        quantity:
          line.quantity != null && Number.isFinite(Number(line.quantity))
            ? Number(line.quantity)
            : null,
        unitAmount:
          line.unitAmount != null && Number.isFinite(Number(line.unitAmount))
            ? Number(line.unitAmount)
            : null,
        accountCode: cleanString(line.accountCode, 20),
        taxType: cleanString(line.taxType, 50),
      };
    }),
  };
}

export const xeroAccountingConnector: AccountingConnector = {
  provider: ACCOUNTING_PROVIDER_XERO,
  displayName: "Xero",
  extractErrorMessage: extractXeroMessage,
  redactError: redactXeroError,
  async fetchOpenPurchaseOrders(orgId) {
    const authed = await getAuthedXeroClient(orgId);
    try {
      const purchaseOrdersById = new Map<string, ExternalPurchaseOrderDocument>();
      for (const status of OPEN_XERO_PO_STATUSES) {
        for (let page = 1; page <= MAX_PAGES; page += 1) {
          const response = await authed.client.accountingApi.getPurchaseOrders(
            authed.tenantId,
            undefined,
            status,
            undefined,
            undefined,
            "Date DESC",
            page,
            PAGE_SIZE
          );
          const batch = response.body.purchaseOrders ?? [];
          for (const order of batch
            .map((entry) => mapXeroPurchaseOrder(entry as Record<string, unknown>))
            .filter((entry): entry is ExternalPurchaseOrderDocument => entry != null)) {
            purchaseOrdersById.set(order.id, order);
          }
          if (batch.length < PAGE_SIZE) break;
        }
      }
      return {
        tenantId: authed.tenantId,
        tenantName: authed.tenantName,
        purchaseOrders: [...purchaseOrdersById.values()].sort((a, b) =>
          (b.date ?? "").localeCompare(a.date ?? "")
        ),
      };
    } catch (error) {
      console.error("Xero purchase order import fetch failed:", redactXeroError(error));
      throw new XeroError(
        `Failed to fetch Xero purchase orders: ${extractXeroMessage(error)}`,
        502
      );
    }
  },
};
