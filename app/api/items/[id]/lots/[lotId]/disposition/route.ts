import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { qualityDispositionActionSchema } from "@/lib/schemas/inventory-disposition";
import { applyLotDispositionAction } from "@/app/(dashboard)/inventory/queries";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "applyLotDispositionAction");
  const { id, lotId } = await (
    ctx as { params: Promise<{ id: string; lotId: string }> }
  ).params;
  const body = await request.json();
  const data = qualityDispositionActionSchema.parse(body);
  const result = await applyLotDispositionAction(id, lotId, data, {
    idempotencyKey,
  });

  return NextResponse.json(result);
});
