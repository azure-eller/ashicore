import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess, withAuthedOrgContext } from "@/lib/dal/auth";
import { purchaseOrders, salesOrders } from "@/lib/db/schema";
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
  const body = await request.json();
  const data = bodySchema.parse(body);

  return withAuthedOrgContext(async (tx) => {
    if (data.entity === "sales_order") {
      const update: Record<string, unknown> = { updatedAt: new Date() };
      if (data.clearPushIds) {
        update.xeroInvoiceId = null;
        update.xeroInvoiceNumber = null;
        update.xeroPushPayloadHash = null;
      }
      if (data.forcePushFailed) {
        update.xeroPushStatus = "failed";
        update.xeroPushError = "smoke-test forced failure";
        update.xeroRetryCount = 0;
      }
      const [row] = await tx
        .update(salesOrders)
        .set(update)
        .where(eq(salesOrders.id, data.id))
        .returning({
          id: salesOrders.id,
          xeroInvoiceId: salesOrders.xeroInvoiceId,
          xeroPushStatus: salesOrders.xeroPushStatus,
        });
      return NextResponse.json({ ok: true, row });
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (data.clearPushIds) {
      update.xeroPurchaseOrderId = null;
      update.xeroPurchaseOrderNumber = null;
      update.xeroPushPayloadHash = null;
    }
    if (data.forcePushFailed) {
      update.xeroPushStatus = "failed";
      update.xeroPushError = "smoke-test forced failure";
      update.xeroRetryCount = 0;
    }
    const [row] = await tx
      .update(purchaseOrders)
      .set(update)
      .where(eq(purchaseOrders.id, data.id))
      .returning({
        id: purchaseOrders.id,
        xeroPurchaseOrderId: purchaseOrders.xeroPurchaseOrderId,
        xeroPushStatus: purchaseOrders.xeroPushStatus,
      });
    return NextResponse.json({ ok: true, row });
  });
});
