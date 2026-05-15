import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { updateSalesOrderSchema } from "@/lib/schemas/sales-orders";
import {
  deleteSalesOrder,
  getSalesOrder,
  SalesError,
  updateSalesOrder,
} from "@/app/(dashboard)/sales/queries";


export const GET = apiHandler(async (_request: Request, ctx: unknown) => {
  await assertModuleReadAccess("sales", _request.headers);
  const { id } = await (ctx as RouteContext).params;
  const order = await getSalesOrder(id);

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  return NextResponse.json(order);
});

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "updateSalesOrder");
  const { id } = await (ctx as RouteContext).params;
  const body = await request.json();
  const data = updateSalesOrderSchema.parse(body);

  try {
    const order = await updateSalesOrder(id, data, { idempotencyKey });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    return NextResponse.json(order);
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});

export const DELETE = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "deleteSalesOrder");
  const { id } = await (ctx as RouteContext).params;
  let result;
  try {
    result = await deleteSalesOrder(id, { idempotencyKey });
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }

  if (!result.deleted) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
});
