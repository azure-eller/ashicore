import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonNotFound } from "@/lib/api/responses";
import { updateTeamMemberAccessSchema } from "@/lib/schemas/team";
import {
  assertAssignableModuleAccess,
  callAuthApi,
  getManageableMember,
} from "@/app/(dashboard)/settings/queries";
import { buildAssignedRoles } from "@/lib/authz";
import { authApiResponseToNextResponse } from "@/app/api/_utils/auth-api-response";


export const PATCH = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  const data = await parseJsonBody(request, updateTeamMemberAccessSchema);
  const member = await getManageableMember(request.headers, id);

  if (!member) {
    return jsonNotFound("Member not found");
  }

  assertAssignableModuleAccess(member.actor.assignedRoles, data.moduleAccess);

  const response = await callAuthApi(request.headers, "updateMemberRole", {
    memberId: id,
    role: buildAssignedRoles(member.member.role, data.moduleAccess),
  });

  return authApiResponseToNextResponse(response);
});

export const DELETE = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  const member = await getManageableMember(request.headers, id);

  if (!member) {
    return jsonNotFound("Member not found");
  }

  const response = await callAuthApi(request.headers, "removeMember", {
    memberIdOrEmail: id,
  });

  return authApiResponseToNextResponse(response);
});
