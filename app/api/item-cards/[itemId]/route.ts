import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import {
  deleteItemCard,
  getItemCard,
  itemCardUpdateSchema,
  ItemCardError,
  updateItemCard,
} from "@/lib/inventory/item-cards";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("inventory", request.headers);
  const { itemId } = await ((ctx as RouteContext).params as unknown as Promise<{ itemId: string }>);
  try {
    const card = await getItemCard(itemId);
    return NextResponse.json(card);
  } catch (error) {
    if (error instanceof ItemCardError) return error.toResponse();
    throw error;
  }
});

export const PATCH = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "updateItemCard");
  const { itemId } = await ((ctx as RouteContext).params as unknown as Promise<{ itemId: string }>);
  const data = itemCardUpdateSchema.parse(await request.json());
  try {
    const item = await updateItemCard(itemId, data, { idempotencyKey });
    return NextResponse.json(item);
  } catch (error) {
    if (error instanceof ItemCardError) return error.toResponse();
    throw error;
  }
});

export const DELETE = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "deleteItemCard");
  const { itemId } = await ((ctx as RouteContext).params as unknown as Promise<{ itemId: string }>);
  try {
    const result = await deleteItemCard(itemId, { idempotencyKey });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ItemCardError) return error.toResponse();
    throw error;
  }
});
