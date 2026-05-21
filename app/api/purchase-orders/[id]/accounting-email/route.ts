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
    eventType: "accounting_email",
    outcome: "failure",
    source: "POST /api/purchase-orders/[id]/accounting-email",
    localEntityType: "purchase_order",
    localEntityId: id,
    metadata: { reason: "po_email_retired" },
  });

  return NextResponse.json(
    { error: "ERP purchase order email through accounting has been retired." },
    { status: 410 }
  );
});
