import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { retryXeroPushForSalesShipment } from "@/app/(dashboard)/sales/queries";
import { XeroError } from "@/lib/xero/errors";
import {
  accountingAuditErrorMetadata,
  tryRecordAccountingAuditEvent,
} from "@/lib/accounting/audit-events";

type ShipmentRouteContext = { params: Promise<{ id: string; shipmentId: string }> };

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const { id, shipmentId } = await (ctx as ShipmentRouteContext).params;
  const context = await assertModuleWriteAccess("sales", request.headers);
  requireIdempotencyKey(request, "retryXeroPushForSalesShipment");

  try {
    const result = await retryXeroPushForSalesShipment(id, shipmentId);
    await tryRecordAccountingAuditEvent({
      organizationId: context.orgId,
      actor: { type: "user", userId: context.userId },
      eventType: "xero_retry",
      outcome: "success",
      source: "POST /api/sales-orders/[id]/shipments/[shipmentId]/xero-push",
      localEntityType: "sales_shipment",
      localEntityId: shipmentId,
      metadata: { orderId: id, ...result.result },
    });
    return NextResponse.json(result.result);
  } catch (error) {
    if (error instanceof XeroError) {
      await tryRecordAccountingAuditEvent({
        organizationId: context.orgId,
        actor: { type: "user", userId: context.userId },
        eventType: "xero_retry",
        outcome: "failure",
        source: "POST /api/sales-orders/[id]/shipments/[shipmentId]/xero-push",
        localEntityType: "sales_shipment",
        localEntityId: shipmentId,
        metadata: { orderId: id, ...accountingAuditErrorMetadata(error) },
      });
      return error.toResponse();
    }
    throw error;
  }
});
