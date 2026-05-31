import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { jsonNotFound, jsonCreated } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { duplicateSalesOrder, SalesError } from "@/app/(dashboard)/sales/queries";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "duplicateSalesOrder");
  const { id } = await (ctx as RouteContext).params;

  try {
    const order = await duplicateSalesOrder(id, { idempotencyKey });

    if (!order) {
      return jsonNotFound("Order not found");
    }

    return jsonCreated(order);
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});
