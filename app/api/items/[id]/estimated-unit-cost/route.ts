import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { jsonNotFound } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { getEstimatedComponentUnitCost } from "@/lib/inventory/queries/bom-read";
import { getItem } from "@/lib/inventory/queries/item-detail";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const item = await getItem(id);

  if (!item) {
    return jsonNotFound("Item not found");
  }

  return NextResponse.json({
    estimatedUnitCost: await getEstimatedComponentUnitCost(id),
  });
});
