import { apiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/responses";
import { AuthorizationError } from "@/lib/authz";
import { autoSyncAccountingPurchaseOrders } from "@/lib/accounting/import-purchase-orders";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function assertCronAccess(request: Request) {
  const secret =
    env.ACCOUNTING_PURCHASE_ORDER_SYNC_SECRET ??
    env.XERO_RETRY_SECRET ??
    env.CRON_SECRET;

  if (!secret) {
    throw new Error(
      "ACCOUNTING_PURCHASE_ORDER_SYNC_SECRET, XERO_RETRY_SECRET, or CRON_SECRET must be configured."
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    throw new AuthorizationError("Invalid accounting purchase order sync token.", 401);
  }
}

export const GET = apiHandler(async (request: Request) => {
  assertCronAccess(request);
  const summary = await autoSyncAccountingPurchaseOrders();
  return jsonOk(summary);
});
