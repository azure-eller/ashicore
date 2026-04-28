import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess, withAuthedOrgContext } from "@/lib/dal/auth";
import { findXeroInvoiceForSalesOrder } from "@/lib/xero/push-invoice";
import { findXeroPurchaseOrderForPurchaseOrder } from "@/lib/xero/push-purchase-order";
import { XeroError } from "@/lib/xero/errors";
import { blockXeroTestEndpointInProduction } from "@/lib/xero/test-endpoints";

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
  const url = new URL(request.url);
  const entity = url.searchParams.get("entity");
  const reference = url.searchParams.get("reference");

  if (!reference) {
    return NextResponse.json({ error: "reference is required" }, { status: 400 });
  }

  return withAuthedOrgContext(async (_tx, orgId) => {
    try {
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
      return NextResponse.json(
        { error: "entity must be 'invoice' or 'purchase_order'" },
        { status: 400 }
      );
    } catch (error) {
      if (error instanceof XeroError) return error.toResponse();
      throw error;
    }
  });
});
