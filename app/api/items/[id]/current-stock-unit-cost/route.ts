import { NextResponse } from "next/server";
import {
  apiHandler,
  requireIdempotencyKey,
  type RouteContext,
} from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonNotFound } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { overrideMaterialCurrentStockUnitCost } from "@/app/(dashboard)/inventory/queries";
import { overrideCurrentStockUnitCostSchema } from "@/lib/schemas/items";

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const idempotencyKey = requireIdempotencyKey(
    request,
    "overrideMaterialCurrentStockUnitCost"
  );
  const { id } = await (ctx as RouteContext).params;
  const data = await parseJsonBody(request, overrideCurrentStockUnitCostSchema);
  const item = await overrideMaterialCurrentStockUnitCost(
    id,
    data.currentStockUnitCost,
    { idempotencyKey }
  );

  if (!item) {
    return jsonNotFound("Item not found");
  }

  return NextResponse.json(item);
});
