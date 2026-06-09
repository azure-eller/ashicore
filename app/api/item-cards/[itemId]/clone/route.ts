import { jsonCreated } from "@/lib/api/responses";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { cloneItemCard } from "@/lib/inventory/item-cards";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "cloneItemCard");
  const { itemId } = await ((ctx as RouteContext).params as unknown as Promise<{
    itemId: string;
  }>);

  const item = await cloneItemCard(itemId, { idempotencyKey });
  return jsonCreated(item);
});
