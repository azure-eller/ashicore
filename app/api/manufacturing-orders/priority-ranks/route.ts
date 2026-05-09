import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { reorderManufacturingOrderPriorityRanksSchema } from "@/lib/schemas/manufacturing-orders";
import {
  ManufacturingError,
  reorderManufacturingOrderPriorityRanks,
} from "@/app/(dashboard)/manufacturing/queries";

export const PATCH = apiHandler(async (request: Request) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const body = await request.json();
  const data = reorderManufacturingOrderPriorityRanksSchema.parse(body);

  try {
    const result = await reorderManufacturingOrderPriorityRanks(data);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ManufacturingError) return error.toResponse();
    throw error;
  }
});
