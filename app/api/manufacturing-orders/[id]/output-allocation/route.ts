import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonNotFound } from "@/lib/api/responses";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { saveManufacturingOutputAllocationSchema } from "@/lib/schemas/manufacturing-orders";
import {
  getManufacturingOutputAllocation,
  ManufacturingError,
  saveManufacturingOutputAllocation,
} from "@/app/(dashboard)/manufacturing/queries";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("manufacturing", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const result = await getManufacturingOutputAllocation(id);

  if (!result) {
    return jsonNotFound("Manufacturing order not found");
  }

  return NextResponse.json(result);
});

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const data = await parseJsonBody(request, saveManufacturingOutputAllocationSchema);

  try {
    const result = await saveManufacturingOutputAllocation(id, data);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ManufacturingError) return error.toResponse();
    throw error;
  }
});
