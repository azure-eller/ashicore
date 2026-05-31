import { jsonCreated } from "@/lib/api/responses";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { assertPlanningReadAccess } from "@/lib/planning/auth";
import { createManufacturingOrderDraftFromPlanning } from "@/lib/planning/actions";
import { createPlanningManufacturingOrderDraftSchema } from "@/lib/schemas/planning";

export const POST = apiHandler(async (request) => {
  await assertPlanningReadAccess(request.headers);
  await assertModuleWriteAccess("manufacturing", request.headers);

  const data = await parseJsonBody(request, createPlanningManufacturingOrderDraftSchema);
  const order = await createManufacturingOrderDraftFromPlanning(data);

  return jsonCreated(order);
});
