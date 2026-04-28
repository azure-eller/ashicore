import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { assertPlanningReadAccess } from "@/lib/planning/auth";
import { updatePlanningRules } from "@/lib/planning/rules";
import { updatePlanningRulesSchema } from "@/lib/schemas/planning";

export const PATCH = apiHandler(async (request, context) => {
  await assertPlanningReadAccess(request.headers);
  await assertModuleWriteAccess("inventory", request.headers);

  const { itemId } = await (
    context as { params: Promise<{ itemId: string }> }
  ).params;
  const body = await request.json();
  const data = updatePlanningRulesSchema.parse(body);
  const result = await updatePlanningRules(itemId, data);

  return NextResponse.json(result);
});
