import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { switchActiveXeroTenant } from "@/lib/dal/xero";
import { tryRecordAccountingAuditEvent } from "@/lib/accounting/audit-events";

const bodySchema = z.object({
  tenantId: z.string().min(1),
});

export const POST = apiHandler(async (request: Request) => {
  const context = await assertModuleWriteAccess("sales", request.headers);
  const data = await parseJsonBody(request, bodySchema);

  const result = await switchActiveXeroTenant(data.tenantId);
  if (!result) {
    await tryRecordAccountingAuditEvent({
      organizationId: context.orgId,
      actor: { type: "user", userId: context.userId },
      eventType: "xero_tenant_switch",
      outcome: "failure",
      source: "POST /api/xero/switch-tenant",
      tenantId: data.tenantId,
      metadata: { reason: "not_connected" },
    });
    return NextResponse.json(
      { error: "Xero is not connected." },
      { status: 409 }
    );
  }
  if (!result.ok) {
    await tryRecordAccountingAuditEvent({
      organizationId: context.orgId,
      actor: { type: "user", userId: context.userId },
      eventType: "xero_tenant_switch",
      outcome: "failure",
      source: "POST /api/xero/switch-tenant",
      tenantId: data.tenantId,
      metadata: { reason: "unauthorized_tenant" },
    });
    return NextResponse.json(
      {
        error:
          "That Xero organisation isn't in this connection's authorised list. Reconnect to update access.",
      },
      { status: 400 }
    );
  }

  await tryRecordAccountingAuditEvent({
    organizationId: context.orgId,
    actor: { type: "user", userId: context.userId },
    eventType: "xero_tenant_switch",
    outcome: "success",
    source: "POST /api/xero/switch-tenant",
    tenantId: result.summary?.tenantId,
    tenantName: result.summary?.tenantName,
  });
  return NextResponse.json(result.summary);
});
