import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { assertPlanningReadAccess } from "@/lib/planning/auth";
import { createPurchaseOrderDraftsFromPlanning } from "@/lib/planning/actions";
import { createPlanningPurchaseOrderDraftsSchema } from "@/lib/schemas/planning";

export const POST = apiHandler(async (request) => {
  await assertPlanningReadAccess(request.headers);
  await assertModuleWriteAccess("purchasing", request.headers);

  const body = await request.json();
  const data = createPlanningPurchaseOrderDraftsSchema.parse(body);
  const result = await createPurchaseOrderDraftsFromPlanning(data);

  return NextResponse.json(result, { status: 201 });
});
