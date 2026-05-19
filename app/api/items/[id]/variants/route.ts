import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { getVariants } from "@/app/(dashboard)/inventory/queries";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("inventory", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const variants = await getVariants(id);
  return NextResponse.json(variants);
});

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  await (ctx as RouteContext).params;
  return NextResponse.json(
    {
      error:
        "Legacy variant creation is disabled. Use /api/item-cards/:itemId/variant-config and /variants/generate instead.",
    },
    { status: 410 }
  );
});
