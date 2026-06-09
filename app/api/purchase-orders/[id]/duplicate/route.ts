import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { jsonNotFound, jsonCreated } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { duplicatePurchaseOrder } from "@/app/(dashboard)/purchasing/queries";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const { id } = await (ctx as RouteContext).params;

  const order = await duplicatePurchaseOrder(id);

  if (!order) {
    return jsonNotFound("Purchase order not found");
  }

  return jsonCreated(order);
});
