import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import {
  patchManufacturingOrderSchema,
  updateManufacturingOrderSchema,
} from "@/lib/schemas/manufacturing-orders";
import {
  deleteManufacturingOrder,
  getManufacturingOrder,
  ManufacturingError,
  patchManufacturingOrder,
  updateManufacturingOrder,
} from "@/app/(dashboard)/manufacturing/queries";


export const GET = apiHandler(async (_request: Request, ctx: unknown) => {
  await assertModuleReadAccess("manufacturing", _request.headers);
  const { id } = await (ctx as RouteContext).params;
  const order = await getManufacturingOrder(id);

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  return NextResponse.json(order);
});

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
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

export const PATCH = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const body = await request.json();
  const data = patchManufacturingOrderSchema.parse(body);

  try {
    const order = await patchManufacturingOrder(id, data);

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
  await assertModuleWriteAccess("manufacturing", _request.headers);
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
