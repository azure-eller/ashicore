import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { jsonError, jsonNotFound } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { InsufficientStockError } from "@/lib/inventory/kernel/errors";
import { reopenManufacturingOrder } from "@/lib/manufacturing/queries/reopen";
import { getManufacturingOrder } from "@/lib/manufacturing/queries/orders-read";
import { ManufacturingError } from "@/lib/manufacturing/queries/errors";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "reopenManufacturingOrder");
  const { id } = await (ctx as RouteContext).params;

  try {
    await reopenManufacturingOrder(id, { idempotencyKey });
  } catch (error) {
    if (error instanceof ManufacturingError) return error.toResponse();
    if (error instanceof InsufficientStockError) {
      return jsonError(
        "Some produced stock has already been shipped or consumed, so this order can't return to work in progress.",
        409
      );
    }
    throw error;
  }

  const detail = await getManufacturingOrder(id);
  if (!detail) {
    return jsonNotFound("Order not found");
  }
  return NextResponse.json(detail);
});
