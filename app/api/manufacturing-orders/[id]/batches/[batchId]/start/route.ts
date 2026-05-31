import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { parseOptionalJsonBody } from "@/lib/api/request-body";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { startManufacturingBatchSchema } from "@/lib/schemas/manufacturing-orders";
import {
  ManufacturingError,
  startManufacturingBatch,
} from "@/app/(dashboard)/manufacturing/queries";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const { id, batchId } = await (
    ctx as { params: Promise<{ id: string; batchId: string }> }
  ).params;
  await parseOptionalJsonBody(request, startManufacturingBatchSchema, {});

  try {
    const result = await startManufacturingBatch(id, batchId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ManufacturingError) return error.toResponse();
    throw error;
  }
});
