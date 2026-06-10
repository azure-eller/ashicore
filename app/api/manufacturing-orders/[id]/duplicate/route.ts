import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { jsonNotFound, jsonCreated } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { duplicateManufacturingOrder } from "@/lib/manufacturing/queries";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const { id } = await (ctx as RouteContext).params;

  const order = await duplicateManufacturingOrder(id);

  if (!order) {
    return jsonNotFound("Order not found");
  }

  return jsonCreated(order);
});
