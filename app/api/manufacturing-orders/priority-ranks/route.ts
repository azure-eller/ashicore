import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { reorderManufacturingOrderPriorityRanksSchema } from "@/lib/schemas/manufacturing-orders";
import {
  ManufacturingError,
  reorderManufacturingOrderPriorityRanks,
} from "@/app/(dashboard)/manufacturing/queries";

export const PATCH = apiHandler(async (request: Request) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const data = await parseJsonBody(
    request,
    reorderManufacturingOrderPriorityRanksSchema,
  );

  try {
    const result = await reorderManufacturingOrderPriorityRanks(data);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ManufacturingError) return error.toResponse();
    throw error;
  }
});
