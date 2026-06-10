import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonError } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { InsufficientStockError } from "@/lib/inventory/kernel/errors";
import { recordManufacturingOutputSchema } from "@/lib/schemas/manufacturing-orders";
import {
  ManufacturingError,
  recordManufacturingOutput,
} from "@/lib/manufacturing/queries";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "recordManufacturingOutput");
  const { id } = await (ctx as RouteContext).params;
  const data = await parseJsonBody(request, recordManufacturingOutputSchema);

  try {
    const result = await recordManufacturingOutput(id, data, { idempotencyKey });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ManufacturingError) return error.toResponse();
    if (error instanceof InsufficientStockError) {
      return jsonError(error.message, 409);
    }
    throw error;
  }
});
