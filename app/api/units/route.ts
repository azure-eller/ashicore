import { jsonCreated } from "@/lib/api/responses";
import { createUnitDefinition } from "@/app/(dashboard)/inventory/queries";
import { insertUnitDefinitionSchema } from "@/lib/schemas/units";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleAccess } from "@/lib/dal/auth";

export const POST = apiHandler(async (request) => {
  await assertModuleAccess("inventory", "admin", request.headers);
  const data = await parseJsonBody(request, insertUnitDefinitionSchema);
  const unit = await createUnitDefinition(data);
  return jsonCreated(unit);
});
