import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { assertPlanningReadAccess } from "@/lib/planning/auth";
import { createPurchaseOrderDraftFromPlanning } from "@/lib/planning/actions";
import { createPlanningPurchaseOrderDraftSchema } from "@/lib/schemas/planning";

export const POST = apiHandler(async (request) => {
  await assertPlanningReadAccess(request.headers);
  await assertModuleWriteAccess("purchasing", request.headers);

  const body = await request.json();
  const data = createPlanningPurchaseOrderDraftSchema.parse(body);
  const order = await createPurchaseOrderDraftFromPlanning(data);

  return NextResponse.json(order, { status: 201 });
});
