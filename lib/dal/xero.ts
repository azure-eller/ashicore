import "server-only";

import { desc, eq } from "drizzle-orm";
import { xeroConnections, xeroImportRuns } from "@/lib/db/schema";
import { withAuthedOrgContext } from "./auth";
import type { XeroConnectionRow } from "@/lib/xero/client";
import {
  probeXeroConnectionHealth,
  type XeroConnectionHealth,
} from "@/lib/xero/health";

export type XeroConnectionSummary = {
  tenantId: string;
  tenantName: string;
  tokenExpiresAt: Date;
  defaultAccountCode: string | null;
  defaultTaxType: string | null;
  invoiceStatusPreference: string;
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
  entityType: "customers" | "suppliers";
  tenantName: string;
  status: string;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  createdAt: Date;
  undoneAt: Date | null;
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
      .from(xeroConnections)
      .where(eq(xeroConnections.organizationId, orgId));
    return row ? toSummary(row) : null;
  });
}

export async function getRecentXeroImportRuns(
  limit = 8
): Promise<XeroImportRunSummary[]> {
  return withAuthedOrgContext(async (tx) => {
    return tx
      .select({
        id: xeroImportRuns.id,
        entityType: xeroImportRuns.entityType,
        tenantName: xeroImportRuns.tenantName,
        status: xeroImportRuns.status,
        createdCount: xeroImportRuns.createdCount,
        updatedCount: xeroImportRuns.updatedCount,
        skippedCount: xeroImportRuns.skippedCount,
        errorCount: xeroImportRuns.errorCount,
        createdAt: xeroImportRuns.createdAt,
        undoneAt: xeroImportRuns.undoneAt,
      })
      .from(xeroImportRuns)
      .orderBy(desc(xeroImportRuns.createdAt))
      .limit(limit);
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
      .from(xeroConnections)
      .where(eq(xeroConnections.organizationId, orgId));
    return row ? { summary: toSummary(row), orgId } : null;
  });
  if (!result) return null;

  const health = await probeXeroConnectionHealth(result.orgId);
  return { ...result.summary, health };
}

export async function deleteXeroConnection() {
  await withAuthedOrgContext(async (tx, orgId) => {
    await tx
      .delete(xeroConnections)
      .where(eq(xeroConnections.organizationId, orgId));
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
      .from(xeroConnections)
      .where(eq(xeroConnections.organizationId, orgId))
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
      .update(xeroConnections)
      .set({
        tenantId: candidate.tenantId,
        tenantName: candidate.tenantName,
        updatedAt: new Date(),
      })
      .where(eq(xeroConnections.organizationId, orgId))
      .returning();

    return { ok: true as const, summary: updated ? toSummary(updated) : null };
  });
}

export async function updateXeroSettings(params: {
  tenantId?: string | null;
  defaultAccountCode: string | null;
  defaultTaxType: string | null;
  invoiceStatusPreference: "DRAFT" | "AUTHORISED";
  autoEmailSalesInvoices: boolean;
  autoEmailPurchaseOrders: boolean;
  purchaseOrderDefaultAccountCode: string | null;
  purchaseOrderDefaultTaxType: string | null;
  purchaseOrderStatusPreference: "DRAFT" | "SUBMITTED" | "AUTHORISED";
}) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [existing] = await tx
      .select()
      .from(xeroConnections)
      .where(eq(xeroConnections.organizationId, orgId))
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
      .update(xeroConnections)
      .set({
        ...tenantPatch,
        defaultAccountCode: params.defaultAccountCode,
        defaultTaxType: params.defaultTaxType,
        invoiceStatusPreference: params.invoiceStatusPreference,
        autoEmailSalesInvoices: params.autoEmailSalesInvoices,
        autoEmailPurchaseOrders: params.autoEmailPurchaseOrders,
        purchaseOrderDefaultAccountCode: params.purchaseOrderDefaultAccountCode,
        purchaseOrderDefaultTaxType: params.purchaseOrderDefaultTaxType,
        purchaseOrderStatusPreference: params.purchaseOrderStatusPreference,
        updatedAt: new Date(),
      })
      .where(eq(xeroConnections.organizationId, orgId))
      .returning();

    return { ok: true as const, summary: row ? toSummary(row) : null };
  });
}
