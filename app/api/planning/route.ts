import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertPlanningReadAccess } from "@/lib/planning/auth";
import { getPlanningSnapshot } from "@/lib/planning/service";

export const GET = apiHandler(async (request) => {
  await assertPlanningReadAccess(request.headers);
  const snapshot = await getPlanningSnapshot();
  return NextResponse.json(snapshot);
});
