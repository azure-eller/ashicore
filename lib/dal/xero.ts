import "server-only";

import { eq } from "drizzle-orm";
import { xeroConnections } from "@/lib/db/schema";
import { withAuthedOrgContext } from "./auth";
import type { XeroConnectionRow } from "@/lib/xero/client";

export type XeroConnectionSummary = {
  tenantId: string;
  tenantName: string;
  tokenExpiresAt: Date;
  defaultAccountCode: string | null;
  defaultTaxType: string | null;
  invoiceStatusPreference: string;
  autoEmailSalesInvoices: boolean;
  purchaseOrderDefaultAccountCode: string | null;
  purchaseOrderDefaultTaxType: string | null;
  purchaseOrderStatusPreference: string;
  updatedAt: Date;
};

function toSummary(row: XeroConnectionRow): XeroConnectionSummary {
  return {
    tenantId: row.tenantId,
    tenantName: row.tenantName,
    tokenExpiresAt: row.tokenExpiresAt,
    defaultAccountCode: row.defaultAccountCode,
    defaultTaxType: row.defaultTaxType,
    invoiceStatusPreference: row.invoiceStatusPreference,
    autoEmailSalesInvoices: row.autoEmailSalesInvoices,
    purchaseOrderDefaultAccountCode: row.purchaseOrderDefaultAccountCode,
    purchaseOrderDefaultTaxType: row.purchaseOrderDefaultTaxType,
    purchaseOrderStatusPreference: row.purchaseOrderStatusPreference,
    updatedAt: row.updatedAt,
  };
}

export async function getXeroConnection(): Promise<XeroConnectionSummary | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [row] = await tx
      .select()
      .from(xeroConnections)
      .where(eq(xeroConnections.organizationId, orgId));
    return row ? toSummary(row) : null;
  });
}

export async function deleteXeroConnection() {
  await withAuthedOrgContext(async (tx, orgId) => {
    await tx
      .delete(xeroConnections)
      .where(eq(xeroConnections.organizationId, orgId));
  });
}

export async function updateXeroSettings(params: {
  defaultAccountCode: string | null;
  defaultTaxType: string | null;
  invoiceStatusPreference: "DRAFT" | "AUTHORISED";
  autoEmailSalesInvoices: boolean;
  purchaseOrderDefaultAccountCode: string | null;
  purchaseOrderDefaultTaxType: string | null;
  purchaseOrderStatusPreference: "DRAFT" | "SUBMITTED" | "AUTHORISED";
}) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [row] = await tx
      .update(xeroConnections)
      .set({
        defaultAccountCode: params.defaultAccountCode,
        defaultTaxType: params.defaultTaxType,
        invoiceStatusPreference: params.invoiceStatusPreference,
        autoEmailSalesInvoices: params.autoEmailSalesInvoices,
        purchaseOrderDefaultAccountCode: params.purchaseOrderDefaultAccountCode,
        purchaseOrderDefaultTaxType: params.purchaseOrderDefaultTaxType,
        purchaseOrderStatusPreference: params.purchaseOrderStatusPreference,
        updatedAt: new Date(),
      })
      .where(eq(xeroConnections.organizationId, orgId))
      .returning();

    return row ? toSummary(row) : null;
  });
}
