import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonOk } from "@/lib/api/responses";
import { assertModuleWriteAccess, withAuthedOrgContext } from "@/lib/dal/auth";
import { accountingDocumentSyncs } from "@/lib/db/schema";
import {
  ACCOUNTING_DOCUMENT_PURCHASE_ORDER,
  ACCOUNTING_PROVIDER_XERO,
} from "@/lib/accounting/sync-state";
import { blockXeroTestEndpointInProduction } from "@/lib/xero/test-endpoints";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  entity: z.enum(["sales_order", "purchase_order"]),
  id: z.string().min(1),
  /** When true, blank xero id + push hash so the next push runs the
   *  reconcile-by-reference path instead of skipping create. */
  clearPushIds: z.boolean().optional().default(false),
  /** When true, set xero_push_status='failed' so the cron picks it up. */
  forcePushFailed: z.boolean().optional().default(false),
});

/**
 * Test-only helper for `pnpm xero:smoke`. Mutates a sales order or PO row
 * to simulate failure modes (lost xero ID, failed push status). Used to
 * exercise reconcile-by-reference and the retry cron without needing the
 * real Xero API to misbehave. Gated by sales:write so only authed dev
 * sessions can hit it.
 */
export const POST = apiHandler(async (request: Request) => {
  const blocked = blockXeroTestEndpointInProduction();
  if (blocked) return blocked;

  await assertModuleWriteAccess("sales", request.headers);
  const data = await parseJsonBody(request, bodySchema);

  return withAuthedOrgContext(async (tx) => {
    if (data.entity === "sales_order") {
      const update: Record<string, unknown> = { updatedAt: new Date() };
      if (data.clearPushIds) {
        update.externalDocumentId = null;
        update.externalDocumentNumber = null;
        update.pushPayloadHash = null;
      }
      if (data.forcePushFailed) {
        update.pushStatus = "failed";
        update.pushError = "smoke-test forced failure";
        update.retryCount = 0;
      }
      const [row] = await tx
        .update(accountingDocumentSyncs)
        .set(update)
        .where(
          and(
            eq(accountingDocumentSyncs.provider, ACCOUNTING_PROVIDER_XERO),
            eq(accountingDocumentSyncs.documentType, "sales_order"),
            eq(accountingDocumentSyncs.documentId, data.id)
          )
        )
        .returning({
          id: accountingDocumentSyncs.documentId,
          xeroInvoiceId: accountingDocumentSyncs.externalDocumentId,
          xeroPushStatus: accountingDocumentSyncs.pushStatus,
        });
      return jsonOk({ row });
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (data.clearPushIds) {
      update.externalDocumentId = null;
      update.externalDocumentNumber = null;
      update.pushPayloadHash = null;
    }
    if (data.forcePushFailed) {
      update.pushStatus = "failed";
      update.pushError = "smoke-test forced failure";
      update.retryCount = 0;
    }
    const [row] = await tx
      .update(accountingDocumentSyncs)
      .set(update)
      .where(
        and(
          eq(accountingDocumentSyncs.provider, ACCOUNTING_PROVIDER_XERO),
          eq(accountingDocumentSyncs.documentType, ACCOUNTING_DOCUMENT_PURCHASE_ORDER),
          eq(accountingDocumentSyncs.documentId, data.id)
        )
      )
      .returning({
        id: accountingDocumentSyncs.documentId,
        xeroPurchaseOrderId: accountingDocumentSyncs.externalDocumentId,
        xeroPushStatus: accountingDocumentSyncs.pushStatus,
      });
    return jsonOk({ row });
  });
});
