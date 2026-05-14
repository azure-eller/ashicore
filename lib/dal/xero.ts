import "server-only";

import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import {
  accountingDocumentSyncs,
  purchaseOrders,
  salesOrders,
  salesShipments,
  integrationConnections,
  integrationImportRuns,
} from "@/lib/db/schema";
import { withAuthedOrgContext } from "./auth";
import { withOrgContext } from "@/lib/db/with-org-context";
import type { XeroConnectionRow } from "@/lib/xero/client";
import {
  probeXeroConnectionHealth,
  type XeroConnectionHealth,
} from "@/lib/xero/health";
import {
  ACCOUNTING_DOCUMENT_PURCHASE_ORDER,
  ACCOUNTING_PROVIDER_XERO,
} from "@/lib/accounting/sync-state";

const XERO_PROVIDER = ACCOUNTING_PROVIDER_XERO;

export type XeroConnectionSummary = {
  tenantId: string;
  tenantName: string;
  tokenExpiresAt: Date;
  defaultAccountCode: string | null;
  defaultTaxType: string | null;
  invoiceStatusPreference: string;
  autoPushSalesInvoices: boolean;
  autoPushPurchaseOrders: boolean;
  autoEmailSalesInvoices: boolean;
  autoEmailPurchaseOrders: boolean;
  purchaseOrderDefaultAccountCode: string | null;
  purchaseOrderDefaultTaxType: string | null;
  purchaseOrderStatusPreference: string;
  authorizedTenants: Array<{ tenantId: string; tenantName: string }>;
  updatedAt: Date;
};

export type XeroImportRunSummary = {
  id: string;
  entityType: "customers" | "suppliers" | "purchasing";
  tenantName: string;
  status: string;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  createdAt: Date;
  undoneAt: Date | null;
};

export type XeroExportHistoryRow = {
  id: string;
  sourceType: "sales_order" | "sales_shipment" | "purchase_order";
  sourceNumber: string;
  partyName: string;
  xeroDocumentNumber: string | null;
  xeroPushStatus: string | null;
  xeroPushError: string | null;
  xeroPushedAt: Date | null;
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
    autoPushSalesInvoices: row.autoPushSalesInvoices,
    autoPushPurchaseOrders: row.autoPushPurchaseOrders,
    autoEmailSalesInvoices: row.autoEmailSalesInvoices,
    autoEmailPurchaseOrders: row.autoEmailPurchaseOrders,
    purchaseOrderDefaultAccountCode: row.purchaseOrderDefaultAccountCode,
    purchaseOrderDefaultTaxType: row.purchaseOrderDefaultTaxType,
    purchaseOrderStatusPreference: row.purchaseOrderStatusPreference,
    authorizedTenants: row.authorizedTenants ?? [],
    updatedAt: row.updatedAt,
  };
}

export async function getXeroConnection(): Promise<XeroConnectionSummary | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [row] = await tx
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.organizationId, orgId),
          eq(integrationConnections.provider, XERO_PROVIDER)
        )
      );
    return row ? toSummary(row) : null;
  });
}

export async function getRecentXeroImportRuns(
  limit = 8
): Promise<XeroImportRunSummary[]> {
  return withAuthedOrgContext(async (tx) => {
    const rows = await tx
      .select({
        id: integrationImportRuns.id,
        entityType: integrationImportRuns.entityType,
        tenantName: integrationImportRuns.tenantName,
        status: integrationImportRuns.status,
        createdCount: integrationImportRuns.createdCount,
        updatedCount: integrationImportRuns.updatedCount,
        skippedCount: integrationImportRuns.skippedCount,
        errorCount: integrationImportRuns.errorCount,
        createdAt: integrationImportRuns.createdAt,
        undoneAt: integrationImportRuns.undoneAt,
      })
      .from(integrationImportRuns)
      .where(
        and(
          eq(integrationImportRuns.provider, XERO_PROVIDER),
          inArray(integrationImportRuns.entityType, ["customers", "suppliers", "purchasing"])
        )
      )
      .orderBy(desc(integrationImportRuns.createdAt))
      .limit(limit);

    return rows.map((row) => ({
      ...row,
      entityType: row.entityType as XeroImportRunSummary["entityType"],
    }));
  });
}

export async function getRecentXeroExports({
  includeSales,
  includePurchasing,
  limit = 20,
}: {
  includeSales: boolean;
  includePurchasing: boolean;
  limit?: number;
}): Promise<XeroExportHistoryRow[]> {
  if (!includeSales && !includePurchasing) return [];

  return withAuthedOrgContext(async (tx, orgId) => {
    const [salesInvoiceRows, shipmentInvoiceRows, purchaseOrderRows] = await Promise.all([
      includeSales
        ? tx
            .select({
              id: salesOrders.id,
              sourceNumber: salesOrders.orderNumber,
              partyName: salesOrders.customerName,
              xeroDocumentNumber: accountingDocumentSyncs.externalDocumentNumber,
              xeroPushStatus: accountingDocumentSyncs.pushStatus,
              xeroPushError: accountingDocumentSyncs.pushError,
              xeroPushedAt: accountingDocumentSyncs.pushedAt,
              updatedAt: accountingDocumentSyncs.updatedAt,
            })
            .from(accountingDocumentSyncs)
            .innerJoin(salesOrders, eq(accountingDocumentSyncs.documentId, salesOrders.id))
            .where(
              and(
                eq(accountingDocumentSyncs.organizationId, orgId),
                eq(accountingDocumentSyncs.provider, XERO_PROVIDER),
                eq(accountingDocumentSyncs.documentType, "sales_order"),
                isNotNull(accountingDocumentSyncs.pushStatus)
              )
            )
            .orderBy(
              desc(accountingDocumentSyncs.lastPushAttemptAt),
              desc(accountingDocumentSyncs.updatedAt)
            )
            .limit(limit)
        : Promise.resolve([]),
      includeSales
        ? tx
            .select({
              id: salesShipments.id,
              sourceNumber: salesShipments.shipmentNumber,
              partyName: salesShipments.customerName,
              xeroDocumentNumber: accountingDocumentSyncs.externalDocumentNumber,
              xeroPushStatus: accountingDocumentSyncs.pushStatus,
              xeroPushError: accountingDocumentSyncs.pushError,
              xeroPushedAt: accountingDocumentSyncs.pushedAt,
              updatedAt: accountingDocumentSyncs.updatedAt,
            })
            .from(accountingDocumentSyncs)
            .innerJoin(salesShipments, eq(accountingDocumentSyncs.documentId, salesShipments.id))
            .where(
              and(
                eq(accountingDocumentSyncs.organizationId, orgId),
                eq(accountingDocumentSyncs.provider, XERO_PROVIDER),
                eq(accountingDocumentSyncs.documentType, "sales_shipment"),
                isNotNull(accountingDocumentSyncs.pushStatus)
              )
            )
            .orderBy(
              desc(accountingDocumentSyncs.lastPushAttemptAt),
              desc(accountingDocumentSyncs.updatedAt)
            )
            .limit(limit)
        : Promise.resolve([]),
      includePurchasing
        ? tx
            .select({
              id: purchaseOrders.id,
              sourceNumber: purchaseOrders.orderNumber,
              partyName: purchaseOrders.supplierName,
              xeroDocumentNumber: accountingDocumentSyncs.externalDocumentNumber,
              xeroPushStatus: accountingDocumentSyncs.pushStatus,
              xeroPushError: accountingDocumentSyncs.pushError,
              xeroPushedAt: accountingDocumentSyncs.pushedAt,
              updatedAt: accountingDocumentSyncs.updatedAt,
            })
            .from(accountingDocumentSyncs)
            .innerJoin(purchaseOrders, eq(accountingDocumentSyncs.documentId, purchaseOrders.id))
            .where(
              and(
                eq(accountingDocumentSyncs.organizationId, orgId),
                eq(accountingDocumentSyncs.provider, XERO_PROVIDER),
                eq(accountingDocumentSyncs.documentType, ACCOUNTING_DOCUMENT_PURCHASE_ORDER),
                isNotNull(accountingDocumentSyncs.pushStatus)
              )
            )
            .orderBy(
              desc(accountingDocumentSyncs.lastPushAttemptAt),
              desc(accountingDocumentSyncs.updatedAt)
            )
            .limit(limit)
        : Promise.resolve([]),
    ]);

    return [
      ...salesInvoiceRows.map((row) => ({
        ...row,
        sourceType: "sales_order" as const,
      })),
      ...shipmentInvoiceRows.map((row) => ({
        ...row,
        sourceType: "sales_shipment" as const,
      })),
      ...purchaseOrderRows.map((row) => ({
        ...row,
        sourceType: "purchase_order" as const,
      })),
    ]
      .sort(
        (left, right) =>
          (right.xeroPushedAt ?? right.updatedAt).getTime() -
          (left.xeroPushedAt ?? left.updatedAt).getTime()
      )
      .slice(0, limit);
  });
}

export async function getXeroAutomationSettingsForOrg(orgId: string) {
  return withOrgContext(orgId, async (tx) => {
    const [row] = await tx
      .select({
        autoPushSalesInvoices: integrationConnections.autoPushSalesInvoices,
        autoPushPurchaseOrders: integrationConnections.autoPushPurchaseOrders,
      })
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.organizationId, orgId),
          eq(integrationConnections.provider, XERO_PROVIDER)
        )
      );

    return row ?? null;
  });
}

export type XeroConnectionWithHealth = XeroConnectionSummary & {
  health: XeroConnectionHealth;
};

/**
 * Same as getXeroConnection, but additionally probes Xero with a
 * cheap read so the caller can show whether the stored tokens still
 * work (Connected / Reconnect required / Missing scope / Transient).
 * Used by the settings page render so the status badge reflects
 * reality without making the user click anything.
 */
export async function getXeroConnectionWithHealth(): Promise<XeroConnectionWithHealth | null> {
  const result = await withAuthedOrgContext(async (tx, orgId) => {
    const [row] = await tx
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.organizationId, orgId),
          eq(integrationConnections.provider, XERO_PROVIDER)
        )
      );
    return row ? { summary: toSummary(row), orgId } : null;
  });
  if (!result) return null;

  const health = await probeXeroConnectionHealth(result.orgId);
  return { ...result.summary, health };
}

export async function deleteXeroConnection() {
  await withAuthedOrgContext(async (tx, orgId) => {
    await tx
      .delete(integrationConnections)
      .where(
        and(
          eq(integrationConnections.organizationId, orgId),
          eq(integrationConnections.provider, XERO_PROVIDER)
        )
      );
  });
}

/**
 * Switch the active Xero tenant for the current org. The new tenant must
 * be one of the tenants the user authorized at OAuth time
 * (`authorized_tenants`); the stored token already has access to all of
 * them, so no re-OAuth is required.
 */
export async function switchActiveXeroTenant(tenantId: string) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [existing] = await tx
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.organizationId, orgId),
          eq(integrationConnections.provider, XERO_PROVIDER)
        )
      )
      .for("update");

    if (!existing) return null;

    const candidate = (existing.authorizedTenants ?? []).find(
      (entry) => entry.tenantId === tenantId
    );
    if (!candidate) {
      return { ok: false as const, reason: "unauthorized_tenant" };
    }

    if (existing.tenantId === candidate.tenantId) {
      return { ok: true as const, summary: toSummary(existing) };
    }

    const [updated] = await tx
      .update(integrationConnections)
      .set({
        tenantId: candidate.tenantId,
        tenantName: candidate.tenantName,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(integrationConnections.organizationId, orgId),
          eq(integrationConnections.provider, XERO_PROVIDER)
        )
      )
      .returning();

    return { ok: true as const, summary: updated ? toSummary(updated) : null };
  });
}

export async function updateXeroSettings(params: {
  tenantId?: string | null;
  defaultAccountCode: string | null;
  defaultTaxType: string | null;
  invoiceStatusPreference: "DRAFT" | "AUTHORISED";
  autoPushSalesInvoices: boolean;
  autoPushPurchaseOrders: boolean;
  autoEmailSalesInvoices: boolean;
  autoEmailPurchaseOrders: boolean;
  purchaseOrderDefaultAccountCode: string | null;
  purchaseOrderDefaultTaxType: string | null;
  purchaseOrderStatusPreference: "DRAFT" | "SUBMITTED" | "AUTHORISED";
}) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [existing] = await tx
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.organizationId, orgId),
          eq(integrationConnections.provider, XERO_PROVIDER)
        )
      )
      .for("update");

    if (!existing) return null;

    let tenantPatch = {};
    if (params.tenantId && params.tenantId !== existing.tenantId) {
      const candidate = (existing.authorizedTenants ?? []).find(
        (entry) => entry.tenantId === params.tenantId
      );
      if (!candidate) {
        return { ok: false as const, reason: "unauthorized_tenant" };
      }
      tenantPatch = {
        tenantId: candidate.tenantId,
        tenantName: candidate.tenantName,
      };
    }

    const [row] = await tx
      .update(integrationConnections)
      .set({
        ...tenantPatch,
        defaultAccountCode: params.defaultAccountCode,
        defaultTaxType: params.defaultTaxType,
        invoiceStatusPreference: params.invoiceStatusPreference,
        autoPushSalesInvoices: params.autoPushSalesInvoices,
        autoPushPurchaseOrders: params.autoPushPurchaseOrders,
        autoEmailSalesInvoices: params.autoEmailSalesInvoices,
        autoEmailPurchaseOrders: params.autoEmailPurchaseOrders,
        purchaseOrderDefaultAccountCode: params.purchaseOrderDefaultAccountCode,
        purchaseOrderDefaultTaxType: params.purchaseOrderDefaultTaxType,
        purchaseOrderStatusPreference: params.purchaseOrderStatusPreference,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(integrationConnections.organizationId, orgId),
          eq(integrationConnections.provider, XERO_PROVIDER)
        )
      )
      .returning();

    return { ok: true as const, summary: row ? toSummary(row) : null };
  });
}
