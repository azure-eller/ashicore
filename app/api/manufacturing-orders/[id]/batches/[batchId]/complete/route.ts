import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonError } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { InsufficientStockError } from "@/lib/inventory/kernel/errors";
import { completeManufacturingBatchSchema } from "@/lib/schemas/manufacturing-orders";
import {
  completeManufacturingBatch,
  ManufacturingError,
} from "@/app/(dashboard)/manufacturing/queries";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "completeManufacturingBatch");
  const { id, batchId } = await (
    ctx as { params: Promise<{ id: string; batchId: string }> }
  ).params;
  const data = await parseJsonBody(request, completeManufacturingBatchSchema);

  try {
    const result = await completeManufacturingBatch(id, batchId, data, {
      idempotencyKey,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ManufacturingError) return error.toResponse();
    if (error instanceof InsufficientStockError) {
      return jsonError(error.message, 409);
    }
    throw error;
  }
});
