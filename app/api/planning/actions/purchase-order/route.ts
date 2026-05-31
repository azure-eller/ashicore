import { jsonCreated } from "@/lib/api/responses";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { assertPlanningReadAccess } from "@/lib/planning/auth";
import { createPurchaseOrderDraftFromPlanning } from "@/lib/planning/actions";
import { createPlanningPurchaseOrderDraftSchema } from "@/lib/schemas/planning";

export const POST = apiHandler(async (request) => {
  await assertPlanningReadAccess(request.headers);
  await assertModuleWriteAccess("purchasing", request.headers);

  const data = await parseJsonBody(request, createPlanningPurchaseOrderDraftSchema);
  const order = await createPurchaseOrderDraftFromPlanning(data);

  return jsonCreated(order);
});
