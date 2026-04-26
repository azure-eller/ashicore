import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { assertPlanningReadAccess } from "@/lib/planning/auth";
import { autoPlanDraftsFromPlanning } from "@/lib/planning/actions";

export const POST = apiHandler(async (request) => {
  await assertPlanningReadAccess(request.headers);
  await assertModuleWriteAccess("purchasing", request.headers);
  await assertModuleWriteAccess("manufacturing", request.headers);

  const result = await autoPlanDraftsFromPlanning();
  return NextResponse.json(result, { status: 201 });
});
