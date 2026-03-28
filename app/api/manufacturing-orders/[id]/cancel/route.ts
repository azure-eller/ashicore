import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import {
  cancelManufacturingOrder,
  ManufacturingError,
} from "@/app/(dashboard)/manufacturing/queries";


export const POST = apiHandler(async (_request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("manufacturing", _request.headers);
  const { id } = await (ctx as RouteContext).params;

  try {
    const order = await cancelManufacturingOrder(id);

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    return NextResponse.json(order);
  } catch (error) {
    if (error instanceof ManufacturingError) return error.toResponse();
    throw error;
  }
});
