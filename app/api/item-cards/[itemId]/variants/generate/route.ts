import { jsonCreated } from "@/lib/api/responses";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import {
  generateVariants,
  generateVariantsSchema,
  ItemCardError,
} from "@/lib/inventory/item-cards";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "generateItemCardVariants");
  const { itemId } = await ((ctx as RouteContext).params as unknown as Promise<{ itemId: string }>);
  const data = await parseJsonBody(request, generateVariantsSchema);
  try {
    const result = await generateVariants(itemId, data, { idempotencyKey });
    return jsonCreated(result);
  } catch (error) {
    if (error instanceof ItemCardError) return error.toResponse();
    throw error;
  }
});
