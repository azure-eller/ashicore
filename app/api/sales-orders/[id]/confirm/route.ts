import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { confirmSalesOrderSchema } from "@/lib/schemas/sales-orders";
import {
  confirmSalesOrder,
  SalesError,
} from "@/app/(dashboard)/sales/queries";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  const body = await request.json().catch(() => ({}));
  const data = confirmSalesOrderSchema.parse(body);

  try {
    const order = await confirmSalesOrder(id, data.confirmOversell === true);

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    return NextResponse.json(order);
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});
