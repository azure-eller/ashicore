import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { releaseManufacturingOrderSchema } from "@/lib/schemas/manufacturing-orders";
import {
  ManufacturingError,
  releaseManufacturingOrder,
} from "@/app/(dashboard)/manufacturing/queries";


export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "releaseManufacturingOrder");
  const { id } = await (ctx as RouteContext).params;
  const body = await request.json().catch(() => ({}));
  const data = releaseManufacturingOrderSchema.parse(body);

  try {
    const order = await releaseManufacturingOrder(id, data.confirmShortage, {
      idempotencyKey,
    });
    return NextResponse.json(order);
  } catch (error) {
    if (error instanceof ManufacturingError) return error.toResponse();
    throw error;
  }
});
