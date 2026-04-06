import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertBomViewAccess, assertModuleReadAccess } from "@/lib/dal/auth";
import { getBomRevisionHistory, getItem } from "@/app/(dashboard)/inventory/queries";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("inventory", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const item = await getItem(id);

  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  await assertBomViewAccess(request.headers, item.bomLocked ?? false);

  const revisions = await getBomRevisionHistory(id);
  return NextResponse.json(revisions);
});
