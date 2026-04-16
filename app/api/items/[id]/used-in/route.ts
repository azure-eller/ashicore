import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { getUsedInParents } from "@/app/(dashboard)/inventory/queries";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("inventory", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const parents = await getUsedInParents(id);
  return NextResponse.json({ parents });
});
