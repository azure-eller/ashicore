import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { releaseManufacturingOrderSchema } from "@/lib/schemas/manufacturing-orders";
import {
  ManufacturingError,
  releaseManufacturingOrder,
} from "@/app/(dashboard)/manufacturing/queries";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const body = await request.json().catch(() => ({}));
  const data = releaseManufacturingOrderSchema.parse(body);

  try {
    const order = await releaseManufacturingOrder(id, data.confirmShortage);
    return NextResponse.json(order);
  } catch (error) {
    if (error instanceof ManufacturingError) return error.toResponse();
    throw error;
  }
});
