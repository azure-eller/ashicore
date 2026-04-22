import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { InsufficientStockError } from "@/lib/inventory/kernel/errors";
import { completeManufacturingOrderSchema } from "@/lib/schemas/manufacturing-orders";
import {
  completeManufacturingOrder,
  ManufacturingError,
} from "@/app/(dashboard)/manufacturing/queries";


export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "completeManufacturingOrder");
  const { id } = await (ctx as RouteContext).params;
  const body = await request.json();
  const data = completeManufacturingOrderSchema.parse(body);

  try {
    const order = await completeManufacturingOrder(id, data, {
      idempotencyKey,
    });
    return NextResponse.json(order);
  } catch (error) {
    if (error instanceof ManufacturingError) return error.toResponse();
    if (error instanceof InsufficientStockError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
});
