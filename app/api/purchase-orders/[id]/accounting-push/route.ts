import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { tryRecordAccountingAuditEvent } from "@/lib/accounting/audit-events";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  const context = await assertModuleWriteAccess("purchasing", request.headers);

  await tryRecordAccountingAuditEvent({
    organizationId: context.orgId,
    actor: { type: "user", userId: context.userId },
    eventType: "accounting_retry",
    outcome: "failure",
    source: "POST /api/purchase-orders/[id]/accounting-push",
    localEntityType: "purchase_order",
    localEntityId: id,
    metadata: { reason: "po_push_retired" },
  });

  return NextResponse.json(
    { error: "ERP purchase order export to accounting has been retired. Import open purchase orders from accounting instead." },
    { status: 410 }
  );
});
