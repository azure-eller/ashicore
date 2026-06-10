import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { jsonNotFound } from "@/lib/api/responses";
import { assertBomViewAccess, assertModuleReadAccess } from "@/lib/dal/auth";
import { getBomRevision } from "@/lib/inventory/queries/bom-read";
import { getItem } from "@/lib/inventory/queries/item-detail";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("inventory", request.headers);
  const { id, revisionId } = await ((ctx as RouteContext).params as Promise<{
    id: string;
    revisionId: string;
  }>);
  const item = await getItem(id);

  if (!item) {
    return jsonNotFound("Item not found");
  }

  await assertBomViewAccess(request.headers, item.bomLocked ?? false);

  const revision = await getBomRevision(id, revisionId);

  if (!revision) {
    return jsonNotFound("BOM revision not found");
  }

  return NextResponse.json(revision);
});
