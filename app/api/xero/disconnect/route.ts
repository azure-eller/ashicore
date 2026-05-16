import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { deleteXeroConnection } from "@/lib/dal/xero";
import { tryRecordAccountingAuditEvent } from "@/lib/accounting/audit-events";

export const POST = apiHandler(async (request: Request) => {
  const context = await assertModuleWriteAccess("sales", request.headers);
  await deleteXeroConnection();
  await tryRecordAccountingAuditEvent({
    organizationId: context.orgId,
    actor: { type: "user", userId: context.userId },
    eventType: "xero_disconnect",
    outcome: "success",
    source: "POST /api/xero/disconnect",
  });
  return NextResponse.json({ disconnected: true });
});
