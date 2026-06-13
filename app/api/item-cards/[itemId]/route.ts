import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonConflict } from "@/lib/api/responses";
import {
  assertModuleAccess,
  assertModuleReadAccess,
  assertModuleWriteAccess,
} from "@/lib/dal/auth";
import { itemCardDocUpdateSchema } from "@/lib/schemas/item-cards";
import { deleteItemCard, getItemCard, updateItemCardDoc } from "@/lib/inventory/item-cards";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("inventory", request.headers);
  const { itemId } = await ((ctx as RouteContext).params as unknown as Promise<{ itemId: string }>);
  const card = await getItemCard(itemId);
  return NextResponse.json(card);
});

export const PATCH = apiHandler(async (request: Request, ctx: unknown) => {
  const idempotencyKey = requireIdempotencyKey(request, "updateItemCardDoc");
  const { itemId } = await ((ctx as RouteContext).params as unknown as Promise<{ itemId: string }>);
  const data = await parseJsonBody(request, itemCardDocUpdateSchema);
  if (data.family?.lotTrackingMode !== undefined) {
    await assertModuleAccess("inventory", "admin", request.headers);
  } else {
    await assertModuleWriteAccess("inventory", request.headers);
  }
  const result = await updateItemCardDoc(itemId, data, { idempotencyKey });
  if (result.kind === "conflict") {
    return jsonConflict("This item was changed elsewhere.", result.current);
  }
  return NextResponse.json(result.card);
});

export const DELETE = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "deleteItemCard");
  const { itemId } = await ((ctx as RouteContext).params as unknown as Promise<{ itemId: string }>);
  const result = await deleteItemCard(itemId, { idempotencyKey });
  return NextResponse.json(result);
});
