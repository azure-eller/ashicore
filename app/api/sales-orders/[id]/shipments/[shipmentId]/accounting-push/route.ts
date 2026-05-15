import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { retryXeroPushForSalesShipment } from "@/app/(dashboard)/sales/queries";
import { XeroError } from "@/lib/xero/errors";

type ShipmentRouteContext = { params: Promise<{ id: string; shipmentId: string }> };

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const { id, shipmentId } = await (ctx as ShipmentRouteContext).params;
  await assertModuleWriteAccess("sales", request.headers);
  requireIdempotencyKey(request, "retryAccountingPushForSalesShipment");

  try {
    const result = await retryXeroPushForSalesShipment(id, shipmentId);
    return NextResponse.json(result.result);
  } catch (error) {
    if (error instanceof XeroError) return error.toResponse();
    throw error;
  }
});
