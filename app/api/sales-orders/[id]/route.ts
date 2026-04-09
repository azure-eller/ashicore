import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
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
  const { id } = await (ctx as RouteContext).params;
  const body = await request.json();
  const data = updateSalesOrderSchema.parse(body);

  try {
    const order = await updateSalesOrder(id, data);

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    return NextResponse.json(order);
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});

export const DELETE = apiHandler(async (_request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", _request.headers);
  const { id } = await (ctx as RouteContext).params;
  const result = await deleteSalesOrder(id);

  if (!result.deleted) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
});
