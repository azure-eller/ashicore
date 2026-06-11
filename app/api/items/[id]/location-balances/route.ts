import { NextResponse } from "next/server";
import { getItemLocationBalances } from "@/lib/inventory/queries/transfers";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("inventory", request.headers);
  const { id } = await (ctx as RouteContext).params;
  return NextResponse.json(await getItemLocationBalances(id));
});
