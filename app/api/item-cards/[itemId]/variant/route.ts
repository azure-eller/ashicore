import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonCreated } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import {
  createItemCardVariant,
  itemCardVariantCreateSchema,
  itemCardVariantUpdateSchema,
  ItemCardError,
  updateItemCardVariant,
} from "@/lib/inventory/item-cards";

/**
 * Variant-level field PATCH for the card UI. Companion to
 * `PATCH /api/item-cards/:itemId` which only handles family-level fields.
 * Card variant tables call this from inline-cell autosave.
 */
export const PATCH = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "updateItemCardVariant");
  const { itemId } = await ((ctx as RouteContext).params as unknown as Promise<{ itemId: string }>);
  const data = await parseJsonBody(request, itemCardVariantUpdateSchema);
  try {
    const item = await updateItemCardVariant(itemId, data, { idempotencyKey });
    return NextResponse.json(item);
  } catch (error) {
    if (error instanceof ItemCardError) return error.toResponse();
    throw error;
  }
});

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "createItemCardVariant");
  const { itemId } = await ((ctx as RouteContext).params as unknown as Promise<{ itemId: string }>);
  const data = await parseJsonBody(request, itemCardVariantCreateSchema);
  try {
    const item = await createItemCardVariant(itemId, data, { idempotencyKey });
    return jsonCreated(item);
  } catch (error) {
    if (error instanceof ItemCardError) return error.toResponse();
    throw error;
  }
});
