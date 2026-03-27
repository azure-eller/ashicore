import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import {
  fulfillSalesOrder,
  SalesError,
} from "@/app/(dashboard)/sales/queries";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = apiHandler(async (_request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;

  try {
    const order = await fulfillSalesOrder(id);

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    return NextResponse.json(order);
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});
