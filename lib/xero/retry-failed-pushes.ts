import "server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  accountingDocumentSyncs,
  organization,
  purchaseOrders,
  salesOrders,
  salesShipments,
  integrationConnections,
} from "@/lib/db/schema";
import {
  ACCOUNTING_DOCUMENT_PURCHASE_BILL,
  ACCOUNTING_PROVIDER_XERO,
} from "@/lib/accounting/sync-state";
import { db } from "@/lib/db";
import { withOrgContext } from "@/lib/db/with-org-context";
import { XeroError } from "./errors";
import { tryRecordAccountingAuditEvent } from "@/lib/accounting/audit-events";

/**
 * Cap on attempts per failed row. After this many attempts the cron
 * stops retrying the row; the user can still trigger a manual retry
 * from the detail page.
 */
const MAX_PUSH_ATTEMPTS = 5;

/** Per-org cap so a runaway org cannot starve other orgs. */
const BATCH_SIZE_PER_ORG = 25;

export type XeroRetryOrgResult = {
  orgId: string;
  salesOrders: {
    candidates: number;
    recovered: number;
    stillFailed: number;
    skipped: number;
  };
  salesShipments: {
    candidates: number;
    recovered: number;
    stillFailed: number;
    skipped: number;
  };
  purchaseOrders: {
    candidates: number;
    recovered: number;
    stillFailed: number;
    skipped: number;
  };
  purchaseBills: {
    candidates: number;
    reset: number;
    active: number;
    failedChecks: number;
  };
  errors: Array<{
    entity: "sales_order" | "sales_shipment" | "purchase_order" | "purchase_bill";
    id: string;
    message: string;
  }>;
};

export type XeroRetrySummary = {
  totalOrgs: number;
  results: XeroRetryOrgResult[];
};

async function listConnectedOrgs(): Promise<string[]> {
  // The xero schema has RLS, and the app role can't read across orgs
  // without `app.current_org_id` set. Walk the RLS-free `organization`
  // table instead and per-org probe inside withOrgContext.
  const orgs = await db
    .select({ id: organization.id })
    .from(organization)
    .orderBy(asc(organization.createdAt));

  const connected: string[] = [];
  for (const { id } of orgs) {
    const hasConnection = await withOrgContext(id, async (tx) => {
      const [row] = await tx
        .select({ orgId: integrationConnections.organizationId })
        .from(integrationConnections)
        .where(
          and(
            eq(integrationConnections.organizationId, id),
            eq(integrationConnections.provider, ACCOUNTING_PROVIDER_XERO)
          )
        )
        .limit(1);
      return row != null;
    });
    if (hasConnection) connected.push(id);
  }
  return connected;
}

async function listFailedSalesOrders(orgId: string): Promise<string[]> {
  return withOrgContext(orgId, async (tx) => {
    const rows = await tx
      .select({ id: salesOrders.id })
      .from(salesOrders)
      .innerJoin(
        accountingDocumentSyncs,
        and(
          eq(accountingDocumentSyncs.provider, ACCOUNTING_PROVIDER_XERO),
          eq(accountingDocumentSyncs.documentType, "sales_order"),
          eq(accountingDocumentSyncs.documentId, salesOrders.id)
        )
      )
      .where(
        and(
          eq(accountingDocumentSyncs.pushStatus, "failed"),
          sql`${accountingDocumentSyncs.retryCount} < ${MAX_PUSH_ATTEMPTS}`,
          isNull(salesOrders.deletedAt)
        )
      )
      .orderBy(accountingDocumentSyncs.lastPushAttemptAt)
      .limit(BATCH_SIZE_PER_ORG);
    return rows.map((row) => row.id);
  });
}

async function listFailedSalesShipments(
  orgId: string
): Promise<Array<{ orderId: string; shipmentId: string }>> {
  return withOrgContext(orgId, async (tx) => {
    const rows = await tx
      .select({
        orderId: salesShipments.salesOrderId,
        shipmentId: salesShipments.id,
      })
      .from(salesShipments)
      .innerJoin(salesOrders, eq(salesShipments.salesOrderId, salesOrders.id))
      .innerJoin(
        accountingDocumentSyncs,
        and(
          eq(accountingDocumentSyncs.provider, ACCOUNTING_PROVIDER_XERO),
          eq(accountingDocumentSyncs.documentType, "sales_shipment"),
          eq(accountingDocumentSyncs.documentId, salesShipments.id)
        )
      )
      .where(
        and(
          eq(accountingDocumentSyncs.pushStatus, "failed"),
          sql`${accountingDocumentSyncs.retryCount} < ${MAX_PUSH_ATTEMPTS}`,
          isNull(salesOrders.deletedAt)
        )
      )
      .orderBy(accountingDocumentSyncs.lastPushAttemptAt)
      .limit(BATCH_SIZE_PER_ORG);
    return rows;
  });
}

async function listPushedPurchaseBills(
  orgId: string
): Promise<Array<{ orderId: string; externalBillId: string }>> {
  return withOrgContext(orgId, async (tx) => {
    const rows = await tx
      .select({
        orderId: purchaseOrders.id,
        externalBillId: accountingDocumentSyncs.externalDocumentId,
      })
      .from(purchaseOrders)
      .innerJoin(
        accountingDocumentSyncs,
        and(
          eq(accountingDocumentSyncs.provider, ACCOUNTING_PROVIDER_XERO),
          eq(
            accountingDocumentSyncs.documentType,
            ACCOUNTING_DOCUMENT_PURCHASE_BILL
          ),
          eq(accountingDocumentSyncs.documentId, purchaseOrders.id)
        )
      )
      .where(
        and(
          eq(accountingDocumentSyncs.pushStatus, "pushed"),
          sql`${accountingDocumentSyncs.externalDocumentId} IS NOT NULL`,
          isNull(purchaseOrders.deletedAt)
        )
      )
      .orderBy(accountingDocumentSyncs.pushedAt, accountingDocumentSyncs.lastPushAttemptAt)
      .limit(BATCH_SIZE_PER_ORG);

    return rows.flatMap((row) =>
      row.externalBillId ? [{ orderId: row.orderId, externalBillId: row.externalBillId }] : []
    );
  });
}

/**
 * Retry every failed Xero push across every connected org. Idempotency
 * is guaranteed by the push functions themselves: they reconcile against
 * Xero by deterministic reference before issuing a new create, which
 * covers the long-tail retry window beyond Xero's ~6-minute idempotency
 * key retention.
 *
 * Email retry is intentionally NOT performed here — duplicate customer
 * emails are worse than a stalled retry, so the email side stays manual.
 */
export async function retryFailedXeroPushes(): Promise<XeroRetrySummary> {
  const orgIds = await listConnectedOrgs();
  const results: XeroRetryOrgResult[] = [];

  const {
    pushSalesOrderToXero,
    pushSalesShipmentToXero,
    markXeroPushFailed,
    markShipmentXeroPushFailed,
  } = await import("./push-invoice");

  for (const orgId of orgIds) {
    const orgResult: XeroRetryOrgResult = {
      orgId,
      salesOrders: { candidates: 0, recovered: 0, stillFailed: 0, skipped: 0 },
      salesShipments: {
        candidates: 0,
        recovered: 0,
        stillFailed: 0,
        skipped: 0,
      },
      purchaseOrders: {
        candidates: 0,
        recovered: 0,
        stillFailed: 0,
        skipped: 0,
      },
      purchaseBills: { candidates: 0, reset: 0, active: 0, failedChecks: 0 },
      errors: [],
    };

    let salesIds: string[] = [];
    try {
      salesIds = await listFailedSalesOrders(orgId);
    } catch (error) {
      orgResult.errors.push({
        entity: "sales_order",
        id: "*",
        message: `Failed to list candidates: ${(error as Error).message}`,
      });
    }
    orgResult.salesOrders.candidates = salesIds.length;

    for (const id of salesIds) {
      try {
        await pushSalesOrderToXero(orgId, id, { allowAutoEmail: false });
        orgResult.salesOrders.recovered += 1;
      } catch (error) {
        if (
          error instanceof XeroError &&
          (error.status === 400 || error.status === 404 || error.status === 409)
        ) {
          // 404 = order disappeared locally; 409 = Xero not connected for
          // this org (race with disconnect). Neither is a real retry
          // candidate; skip without bumping failure count further.
          orgResult.salesOrders.skipped += 1;
          continue;
        }

        try {
          await markXeroPushFailed(orgId, id, error);
        } catch {
          // ignore — best effort.
        }

        orgResult.salesOrders.stillFailed += 1;
        orgResult.errors.push({
          entity: "sales_order",
          id,
          message: (error as Error).message ?? "unknown",
        });
      }
    }

    let shipmentIds: Array<{ orderId: string; shipmentId: string }> = [];
    try {
      shipmentIds = await listFailedSalesShipments(orgId);
    } catch (error) {
      orgResult.errors.push({
        entity: "sales_shipment",
        id: "*",
        message: `Failed to list candidates: ${(error as Error).message}`,
      });
    }
    orgResult.salesShipments.candidates = shipmentIds.length;

    for (const { orderId, shipmentId } of shipmentIds) {
      try {
        await pushSalesShipmentToXero(orgId, orderId, shipmentId, {
          allowAutoEmail: false,
        });
        orgResult.salesShipments.recovered += 1;
      } catch (error) {
        if (
          error instanceof XeroError &&
          (error.status === 400 || error.status === 404 || error.status === 409)
        ) {
          orgResult.salesShipments.skipped += 1;
          continue;
        }

        try {
          await markShipmentXeroPushFailed(orgId, shipmentId, error);
        } catch {
          // ignore — best effort.
        }

        orgResult.salesShipments.stillFailed += 1;
        orgResult.errors.push({
          entity: "sales_shipment",
          id: shipmentId,
          message: (error as Error).message ?? "unknown",
        });
      }
    }

    let purchaseBillIds: Array<{ orderId: string; externalBillId: string }> = [];
    try {
      purchaseBillIds = await listPushedPurchaseBills(orgId);
    } catch (error) {
      orgResult.errors.push({
        entity: "purchase_bill",
        id: "*",
        message: `Failed to list candidates: ${(error as Error).message}`,
      });
    }
    orgResult.purchaseBills.candidates = purchaseBillIds.length;

    if (purchaseBillIds.length > 0) {
      const { reconcileXeroPurchaseBillExternalState } = await import(
        "./push-purchase-bill"
      );

      for (const { orderId, externalBillId } of purchaseBillIds) {
        try {
          const result = await reconcileXeroPurchaseBillExternalState(
            orgId,
            orderId,
            externalBillId
          );
          if (result.reset) {
            orgResult.purchaseBills.reset += 1;
          } else {
            orgResult.purchaseBills.active += 1;
          }
        } catch (error) {
          orgResult.purchaseBills.failedChecks += 1;
          orgResult.errors.push({
            entity: "purchase_bill",
            id: orderId,
            message: (error as Error).message ?? "unknown",
          });
        }
      }
    }

    await tryRecordAccountingAuditEvent({
      organizationId: orgId,
      actor: { type: "process", processName: "xero_retry_cron" },
      eventType: "xero_retry",
      outcome: orgResult.errors.length > 0 ? "failure" : "success",
      source: "GET /api/internal/xero-retry",
      metadata: {
        salesOrders: orgResult.salesOrders,
        salesShipments: orgResult.salesShipments,
        purchaseOrders: orgResult.purchaseOrders,
        purchaseBills: orgResult.purchaseBills,
        errorCount: orgResult.errors.length,
      },
    });
    results.push(orgResult);
  }

  return { totalOrgs: orgIds.length, results };
}
