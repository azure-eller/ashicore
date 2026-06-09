import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { itemCardSellableSchema, updateItemCardSellable } from "@/lib/inventory/item-cards";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "updateItemCardSellable");
  const { itemId } = await ((ctx as RouteContext).params as unknown as Promise<{ itemId: string }>);
  const data = await parseJsonBody(request, itemCardSellableSchema);
  const card = await updateItemCardSellable(itemId, data, { idempotencyKey });
  return NextResponse.json(card);
});
