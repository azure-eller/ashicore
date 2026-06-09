import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import {
  assertModuleAccess,
  assertModuleReadAccess,
  assertModuleWriteAccess,
} from "@/lib/dal/auth";
import { deleteItemCard, getItemCard, itemCardUpdateSchema, updateItemCard } from "@/lib/inventory/item-cards";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("inventory", request.headers);
  const { itemId } = await ((ctx as RouteContext).params as unknown as Promise<{ itemId: string }>);
  const card = await getItemCard(itemId);
  return NextResponse.json(card);
});

export const PATCH = apiHandler(async (request: Request, ctx: unknown) => {
  const idempotencyKey = requireIdempotencyKey(request, "updateItemCard");
  const { itemId } = await ((ctx as RouteContext).params as unknown as Promise<{ itemId: string }>);
  const data = await parseJsonBody(request, itemCardUpdateSchema);
  if (data.lotTrackingMode !== undefined) {
    await assertModuleAccess("inventory", "admin", request.headers);
  } else {
    await assertModuleWriteAccess("inventory", request.headers);
  }
  const item = await updateItemCard(itemId, data, { idempotencyKey });
  return NextResponse.json(item);
});

export const DELETE = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "deleteItemCard");
  const { itemId } = await ((ctx as RouteContext).params as unknown as Promise<{ itemId: string }>);
  const result = await deleteItemCard(itemId, { idempotencyKey });
  return NextResponse.json(result);
});
