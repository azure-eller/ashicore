import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import {
  copyVariantConfigFromItem,
  copyVariantConfigSchema,
  ItemCardError,
} from "@/lib/inventory/item-cards";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "copyItemCardVariantConfig");
  const { itemId } = await ((ctx as RouteContext).params as unknown as Promise<{ itemId: string }>);
  const data = await parseJsonBody(request, copyVariantConfigSchema);

  try {
    const card = await copyVariantConfigFromItem(itemId, data, { idempotencyKey });
    return NextResponse.json(card);
  } catch (error) {
    if (error instanceof ItemCardError) return error.toResponse();
    throw error;
  }
});
