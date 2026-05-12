import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { lotQuantityAdjustmentSchema } from "@/lib/schemas/lot-adjustment";
import { adjustLotQuantity, InventoryError } from "@/app/(dashboard)/inventory/queries";
import { InsufficientStockError } from "@/lib/inventory/kernel";

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "adjustLotQuantity");
  const { id, lotId } = await (
    ctx as { params: Promise<{ id: string; lotId: string }> }
  ).params;
  const body = await request.json();
  const data = lotQuantityAdjustmentSchema.parse(body);

  try {
    const result = await adjustLotQuantity(id, lotId, data, { idempotencyKey });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof InventoryError) return error.toResponse();
    throw error;
  }
});
