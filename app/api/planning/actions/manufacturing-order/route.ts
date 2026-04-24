import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { assertPlanningReadAccess } from "@/lib/planning/auth";
import { createManufacturingOrderDraftFromPlanning } from "@/lib/planning/actions";
import { createPlanningManufacturingOrderDraftSchema } from "@/lib/schemas/planning";

export const POST = apiHandler(async (request) => {
  await assertPlanningReadAccess(request.headers);
  await assertModuleWriteAccess("manufacturing", request.headers);

  const body = await request.json();
  const data = createPlanningManufacturingOrderDraftSchema.parse(body);
  const order = await createManufacturingOrderDraftFromPlanning(data);

  return NextResponse.json(order, { status: 201 });
});
