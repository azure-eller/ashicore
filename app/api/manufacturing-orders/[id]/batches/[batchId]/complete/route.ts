import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { completeManufacturingBatchSchema } from "@/lib/schemas/manufacturing-orders";
import {
  completeManufacturingBatch,
  ManufacturingError,
} from "@/app/(dashboard)/manufacturing/queries";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const { id, batchId } = await (
    ctx as { params: Promise<{ id: string; batchId: string }> }
  ).params;
  const body = await request.json();
  const data = completeManufacturingBatchSchema.parse(body);

  try {
    const result = await completeManufacturingBatch(id, batchId, data);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ManufacturingError) return error.toResponse();
    throw error;
  }
});
