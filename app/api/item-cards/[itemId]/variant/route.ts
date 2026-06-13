import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonCreated } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { itemCardVariantCreateSchema } from "@/lib/schemas/item-cards";
import { createItemCardVariant } from "@/lib/inventory/item-cards";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "createItemCardVariant");
  const { itemId } = await ((ctx as RouteContext).params as unknown as Promise<{ itemId: string }>);
  const data = await parseJsonBody(request, itemCardVariantCreateSchema);
  const item = await createItemCardVariant(itemId, data, { idempotencyKey });
  return jsonCreated(item);
});
