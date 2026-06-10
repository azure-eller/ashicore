import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { jsonNotFound } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { getManufacturingOrder, startManufacturingOrderWork } from "@/lib/manufacturing/queries";

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
