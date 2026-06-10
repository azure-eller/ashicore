import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { jsonNotFound, jsonCreated } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { duplicateSalesOrder } from "@/lib/sales/queries";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "duplicateSalesOrder");
  const { id } = await (ctx as RouteContext).params;

  const order = await duplicateSalesOrder(id, { idempotencyKey });

  if (!order) {
    return jsonNotFound("Order not found");
  }

  return jsonCreated(order);
});
