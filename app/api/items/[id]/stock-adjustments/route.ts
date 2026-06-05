import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { adjustItemStock } from "@/lib/dal/stock-adjustments";
import { stockAdjustmentSchema } from "@/lib/schemas/stock-adjustments";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const idempotencyKey = requireIdempotencyKey(request, "adjustStock");
  const result = await adjustItemStock(
    id,
    await parseJsonBody(request, stockAdjustmentSchema),
    { idempotencyKey }
  );

  if (result instanceof NextResponse) {
    return result;
  }

  return NextResponse.json(result);
});
