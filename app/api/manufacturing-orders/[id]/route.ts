import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { updateManufacturingOrderSchema } from "@/lib/schemas/manufacturing-orders";
import {
  deleteManufacturingOrder,
  getManufacturingOrder,
  ManufacturingError,
  updateManufacturingOrder,
} from "@/app/(dashboard)/manufacturing/queries";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (_request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  const order = await getManufacturingOrder(id);

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  return NextResponse.json(order);
});

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  const body = await request.json();
  const data = updateManufacturingOrderSchema.parse(body);

  try {
    const order = await updateManufacturingOrder(id, data);

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    return NextResponse.json(order);
  } catch (error) {
    if (error instanceof ManufacturingError) return error.toResponse();
    throw error;
  }
});

export const DELETE = apiHandler(async (_request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  const result = await deleteManufacturingOrder(id);

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  if (!result.deleted) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
});
