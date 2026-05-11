import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { shipSalesShipmentSchema } from "@/lib/schemas/sales-orders";
import { SalesError, shipSalesShipment } from "@/app/(dashboard)/sales/queries";

type ShipmentRouteContext = { params: Promise<{ id: string; shipmentId: string }> };

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const { id, shipmentId } = await (ctx as ShipmentRouteContext).params;
  await assertModuleWriteAccess("sales", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "shipSalesShipment");
  const body = await request.json().catch(() => ({}));
  const data = shipSalesShipmentSchema.parse(body);

  try {
    const shipment = await shipSalesShipment(id, shipmentId, data, {
      idempotencyKey,
    });
    if (!shipment) {
      return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
    }
    return NextResponse.json(shipment);
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});
