import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { createTeamInvitationSchema } from "@/lib/schemas/team";
import {
  assertAssignableModuleAccess,
  buildInvitationRolePayload,
  callAuthApi,
  ensureInvitableRole,
} from "@/app/(dashboard)/settings/queries";
import { getAccessPresetModuleAccess } from "@/lib/authz";
import { authApiResponseToNextResponse } from "@/app/api/_utils/auth-api-response";

export const POST = apiHandler(async (request) => {
  const data = await parseJsonBody(request, createTeamInvitationSchema);

  const actor = await ensureInvitableRole(request.headers);
  assertAssignableModuleAccess(
    actor.assignedRoles,
    getAccessPresetModuleAccess(data.presetKey)
  );

  const response = await callAuthApi(request.headers, "createInvitation", {
    email: data.email,
    role: buildInvitationRolePayload(data.presetKey),
  });
  return authApiResponseToNextResponse(response);
});
