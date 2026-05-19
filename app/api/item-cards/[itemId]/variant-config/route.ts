import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import {
  ItemCardError,
  updateVariantConfig,
  variantConfigSchema,
} from "@/lib/inventory/item-cards";

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "updateItemCardVariantConfig");
  const { itemId } = await ((ctx as RouteContext).params as unknown as Promise<{ itemId: string }>);
  const data = variantConfigSchema.parse(await request.json());
  try {
    const card = await updateVariantConfig(itemId, data, { idempotencyKey });
    return NextResponse.json(card);
  } catch (error) {
    if (error instanceof ItemCardError) return error.toResponse();
    throw error;
  }
});
