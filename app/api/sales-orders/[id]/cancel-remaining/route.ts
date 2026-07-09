import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { jsonNotFound } from "@/lib/api/responses";
import { cancelRemainingSalesOrder } from "@/lib/sales/queries/order-write";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  await assertModuleWriteAccess("sales", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "cancelRemainingSalesOrder");

  const order = await cancelRemainingSalesOrder(id, { idempotencyKey });

  if (!order) {
    return jsonNotFound("Order not found");
  }

  return NextResponse.json(order);
});
