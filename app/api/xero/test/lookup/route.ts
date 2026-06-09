import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { jsonError } from "@/lib/api/responses";
import { requestSearchParams } from "@/lib/routing/search-params";
import { assertModuleWriteAccess, withAuthedOrgContext } from "@/lib/dal/auth";
import { findXeroInvoiceForSalesOrder } from "@/lib/xero/push-invoice";
import { findXeroPurchaseOrderForPurchaseOrder } from "@/lib/xero/push-purchase-order";import { blockXeroTestEndpointInProduction } from "@/lib/xero/test-endpoints";

export const dynamic = "force-dynamic";

/**
 * Test-only helper for `pnpm xero:smoke`. Looks up an invoice or PO in
 * Xero by ERP reference and returns whether it exists. Not exposed in
 * the UI; gated by sales:write so only authed dev sessions can hit it.
 */
export const GET = apiHandler(async (request: Request) => {
  const blocked = blockXeroTestEndpointInProduction();
  if (blocked) return blocked;

  await assertModuleWriteAccess("sales", request.headers);
  const searchParams = requestSearchParams(request);
  const entity = searchParams.get("entity");
  const reference = searchParams.get("reference");

  if (!reference) {
    return jsonError("reference is required");
  }

  return withAuthedOrgContext(async (_tx, orgId) => {
    if (entity === "invoice") {
      const found = await findXeroInvoiceForSalesOrder(orgId, reference);
      return NextResponse.json({ found: !!found, match: found });
    }
    if (entity === "purchase_order") {
      const found = await findXeroPurchaseOrderForPurchaseOrder(
        orgId,
        reference
      );
      return NextResponse.json({ found: !!found, match: found });
    }
    return jsonError("entity must be 'invoice' or 'purchase_order'");
  });
});
