import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertBomViewAccess, assertModuleReadAccess } from "@/lib/dal/auth";
import { getBomRevision, getItem } from "@/app/(dashboard)/inventory/queries";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("inventory", request.headers);
  const { id, revisionId } = await ((ctx as RouteContext).params as Promise<{
    id: string;
    revisionId: string;
  }>);
  const item = await getItem(id);

  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  await assertBomViewAccess(request.headers, item.bomLocked ?? false);

  const revision = await getBomRevision(id, revisionId);

  if (!revision) {
    return NextResponse.json({ error: "BOM revision not found" }, { status: 404 });
  }

  return NextResponse.json(revision);
});
