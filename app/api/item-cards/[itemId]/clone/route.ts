import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { cloneItemCard, ItemCardError } from "@/lib/inventory/item-cards";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "cloneItemCard");
  const { itemId } = await ((ctx as RouteContext).params as unknown as Promise<{
    itemId: string;
  }>);

  try {
    const item = await cloneItemCard(itemId, { idempotencyKey });
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    if (error instanceof ItemCardError) return error.toResponse();
    throw error;
  }
});
