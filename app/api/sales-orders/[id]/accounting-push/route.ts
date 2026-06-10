import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { retryAccountingPushForSalesOrder } from "@/lib/sales/queries/accounting";
import { XeroError } from "@/lib/xero/errors";
import { QuickBooksError } from "@/lib/accounting/providers/quickbooks/client";
import {
  accountingAuditErrorMetadata,
  tryRecordAccountingAuditEvent,
} from "@/lib/accounting/audit-events";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  const context = await assertModuleWriteAccess("sales", request.headers);

  try {
    const result = await retryAccountingPushForSalesOrder(id);
    await tryRecordAccountingAuditEvent({
      organizationId: context.orgId,
      actor: { type: "user", userId: context.userId },
      eventType: "accounting_retry",
      outcome: "success",
      source: "POST /api/sales-orders/[id]/accounting-push",
      localEntityType: "sales_order",
      localEntityId: id,
      metadata: result.result,
    });
    return NextResponse.json(result.result);
  } catch (error) {
    if (error instanceof XeroError || error instanceof QuickBooksError) {
      await tryRecordAccountingAuditEvent({
        organizationId: context.orgId,
        actor: { type: "user", userId: context.userId },
        eventType: "accounting_retry",
        outcome: "failure",
        source: "POST /api/sales-orders/[id]/accounting-push",
        localEntityType: "sales_order",
        localEntityId: id,
        metadata: accountingAuditErrorMetadata(error),
      });
      return error.toResponse();
    }
    throw error;
  }
});
