import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { insertVariantSchema } from "@/lib/schemas/items";
import { createVariant, getVariants, InventoryError } from "@/app/(dashboard)/inventory/queries";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("inventory", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const variants = await getVariants(id);
  return NextResponse.json(variants);
});

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const body = await request.json();
  const data = insertVariantSchema.parse(body);
  try {
    const variant = await createVariant(id, data);
    return NextResponse.json(variant, { status: 201 });
  } catch (error) {
    if (error instanceof InventoryError) return error.toResponse();
    throw error;
  }
});
