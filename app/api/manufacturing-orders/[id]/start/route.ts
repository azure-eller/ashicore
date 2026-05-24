import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import {
  getManufacturingOrder,
  ManufacturingError,
  startManufacturingOrderWork,
} from "@/app/(dashboard)/manufacturing/queries";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params;

  try {
    await startManufacturingOrderWork(id);
    const detail = await getManufacturingOrder(id);
    if (!detail) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (error) {
    if (error instanceof ManufacturingError) return error.toResponse();
    throw error;
  }
});
