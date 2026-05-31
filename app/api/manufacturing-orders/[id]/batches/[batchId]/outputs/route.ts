import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonError } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { InsufficientStockError } from "@/lib/inventory/kernel/errors";
import { recordManufacturingOutputSchema } from "@/lib/schemas/manufacturing-orders";
import {
  ManufacturingError,
  recordManufacturingOutput,
} from "@/app/(dashboard)/manufacturing/queries";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "recordManufacturingBatchOutput");
  const { id, batchId } = await (
    ctx as { params: Promise<{ id: string; batchId: string }> }
  ).params;
  const data = await parseJsonBody(request, recordManufacturingOutputSchema);

  try {
    const result = await recordManufacturingOutput(id, data, {
      idempotencyKey,
      batchId,
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
