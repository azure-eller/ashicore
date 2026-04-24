import { NextResponse } from "next/server";
import {
  apiHandler,
  requireIdempotencyKey,
  type RouteContext,
} from "@/lib/api/handler";
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
  const body = await request.json();
  const data = overrideCurrentStockUnitCostSchema.parse(body);
  const item = await overrideMaterialCurrentStockUnitCost(
    id,
    data.currentStockUnitCost,
    { idempotencyKey }
  );

  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  return NextResponse.json(item);
});
