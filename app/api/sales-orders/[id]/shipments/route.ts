import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { salesShipmentInputSchema } from "@/lib/schemas/sales-orders";
import { createSalesShipment, SalesError } from "@/app/(dashboard)/sales/queries";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  await assertModuleWriteAccess("sales", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "createSalesShipment");
  const body = await request.json();
  const parsed = salesShipmentInputSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { errors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const shipment = await createSalesShipment(id, parsed.data, { idempotencyKey });
    if (!shipment) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    return NextResponse.json(shipment, { status: 201 });
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});
