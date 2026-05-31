import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonNotFound } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { updateManufacturingOrderPrioritySchema } from "@/lib/schemas/manufacturing-orders";
import {
  ManufacturingError,
  updateManufacturingOrderPriority,
} from "@/app/(dashboard)/manufacturing/queries";

export const PATCH = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const data = await parseJsonBody(request, updateManufacturingOrderPrioritySchema);

  try {
    const result = await updateManufacturingOrderPriority(id, data);

    if (!result) {
      return jsonNotFound("Order not found");
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ManufacturingError) return error.toResponse();
    throw error;
  }
});
