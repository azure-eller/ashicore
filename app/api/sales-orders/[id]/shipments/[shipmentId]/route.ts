import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { salesShipmentInputSchema } from "@/lib/schemas/sales-orders";
import {
  cancelSalesShipment,
  SalesError,
  updateSalesShipment,
} from "@/app/(dashboard)/sales/queries";

type ShipmentRouteContext = { params: Promise<{ id: string; shipmentId: string }> };

export const PATCH = apiHandler(async (request: Request, ctx: unknown) => {
  const { id, shipmentId } = await (ctx as ShipmentRouteContext).params;
  await assertModuleWriteAccess("sales", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "updateSalesShipment");
  const body = await request.json();
  const data = salesShipmentInputSchema.parse(body);

  try {
    const shipment = await updateSalesShipment(id, shipmentId, data, {
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

export const DELETE = apiHandler(async (request: Request, ctx: unknown) => {
  const { id, shipmentId } = await (ctx as ShipmentRouteContext).params;
  await assertModuleWriteAccess("sales", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "cancelSalesShipment");

  try {
    const shipment = await cancelSalesShipment(id, shipmentId, { idempotencyKey });
    if (!shipment) {
      return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
    }
    return NextResponse.json(shipment);
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});
