import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { salesShipmentCostsInputSchema } from "@/lib/schemas/sales-orders";
import {
  SalesError,
  updateSalesShipmentCosts,
} from "@/app/(dashboard)/sales/queries";

type ShipmentRouteContext = { params: Promise<{ id: string; shipmentId: string }> };

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  const { id, shipmentId } = await (ctx as ShipmentRouteContext).params;
  await assertModuleWriteAccess("sales", request.headers);
  const body = await request.json();
  const data = salesShipmentCostsInputSchema.parse(body);

  try {
    const result = await updateSalesShipmentCosts(id, shipmentId, data);
    if (!result) {
      return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});
