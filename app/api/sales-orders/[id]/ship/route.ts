import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { parseOptionalJsonBody } from "@/lib/api/request-body";
import { jsonNotFound } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { shipSalesOrder } from "@/lib/sales/queries/shipping";
import { shipSalesOrderSchema } from "@/lib/schemas/sales-orders";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  await assertModuleWriteAccess("sales", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "shipSalesOrder");
  const options = await parseOptionalJsonBody(request, shipSalesOrderSchema, {});

  const order = await shipSalesOrder(id, { idempotencyKey, ...options });

  if (!order) {
    return jsonNotFound("Order not found");
  }

  return NextResponse.json(order);
});
