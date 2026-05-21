import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess, getAuthedMemberContext } from "@/lib/dal/auth";
import { tryRecordAccountingAuditEvent } from "@/lib/accounting/audit-events";

export const POST = apiHandler(async (request: Request) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const context = await getAuthedMemberContext();

  await tryRecordAccountingAuditEvent({
    organizationId: context.orgId,
    actor: { type: "user", userId: context.userId },
    eventType: "accounting_import",
    outcome: "failure",
    source: "POST /api/accounting/import/purchasing",
    localEntityType: "purchasing",
    metadata: { reason: "supplier_price_sync_retired" },
  });

  return NextResponse.json(
    { error: "Supplier price sync from accounting purchase history has been retired. Import open purchase orders from accounting instead." },
    { status: 410 }
  );
});
