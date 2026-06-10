import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { jsonNotFound } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { startManufacturingOrderWork } from "@/lib/manufacturing/queries/batches";
import { getManufacturingOrder } from "@/lib/manufacturing/queries/orders-read";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params;

  await startManufacturingOrderWork(id);
  const detail = await getManufacturingOrder(id);
  if (!detail) {
    return jsonNotFound("Order not found");
  }
  return NextResponse.json(detail);
});
