import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { parseOptionalJsonBody } from "@/lib/api/request-body";
import { jsonNotFound } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { confirmSalesOrderSchema } from "@/lib/schemas/sales-orders";
import {
  confirmSalesOrder,
  SalesError,
} from "@/app/(dashboard)/sales/queries";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  await assertModuleWriteAccess("sales", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "confirmSalesOrder");
  const data = await parseOptionalJsonBody(request, confirmSalesOrderSchema, {});

  try {
    const order = await confirmSalesOrder(id, data, { idempotencyKey });

    if (!order) {
      return jsonNotFound("Order not found");
    }

    return NextResponse.json(order);
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});
