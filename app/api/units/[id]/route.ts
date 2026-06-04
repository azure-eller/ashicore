import { jsonNotFound, jsonOk, jsonSuccess } from "@/lib/api/responses";
import { deleteUnitDefinition, updateUnitDefinition } from "@/app/(dashboard)/inventory/queries";
import { insertUnitDefinitionSchema } from "@/lib/schemas/units";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleAccess } from "@/lib/dal/auth";

export const PATCH = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleAccess("inventory", "admin", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const data = await parseJsonBody(request, insertUnitDefinitionSchema);
  const unit = await updateUnitDefinition(id, data);
  return jsonOk(unit);
});

export const DELETE = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleAccess("inventory", "admin", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const deleted = await deleteUnitDefinition(id);

  if (!deleted) {
    return jsonNotFound("Unit not found");
  }

  return jsonSuccess();
});
