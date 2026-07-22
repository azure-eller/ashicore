import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { applyItemDispositionAction } from "@/lib/inventory/queries/item-lots";
import { qualityDispositionActionSchema } from "@/lib/schemas/inventory-disposition";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "applyItemDispositionAction");
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params;
  const data = await parseJsonBody(request, qualityDispositionActionSchema);
  const result = await applyItemDispositionAction(id, data, { idempotencyKey });

  return NextResponse.json(result);
});
