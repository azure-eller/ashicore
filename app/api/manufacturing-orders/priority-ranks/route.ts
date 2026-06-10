import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { reorderManufacturingOrderPriorityRanksSchema } from "@/lib/schemas/manufacturing-orders";
import { reorderManufacturingOrderPriorityRanks } from "@/lib/manufacturing/queries";

export const PATCH = apiHandler(async (request: Request) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const data = await parseJsonBody(
    request,
    reorderManufacturingOrderPriorityRanksSchema,
  );

  const result = await reorderManufacturingOrderPriorityRanks(data);
  return NextResponse.json(result);
});
