import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import {
  generateVariantPreview,
  ItemCardError,
} from "@/lib/inventory/item-cards";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("inventory", request.headers);
  const { itemId } = await ((ctx as RouteContext).params as unknown as Promise<{ itemId: string }>);
  try {
    const preview = await generateVariantPreview(itemId);
    return NextResponse.json(preview);
  } catch (error) {
    if (error instanceof ItemCardError) return error.toResponse();
    throw error;
  }
});
