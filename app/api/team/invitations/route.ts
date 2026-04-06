import { apiHandler } from "@/lib/api/handler";
import { createTeamInvitationSchema } from "@/lib/schemas/team";
import {
  buildInvitationRolePayload,
  callAuthApi,
  ensureInvitableRole,
} from "@/app/(dashboard)/settings/queries";
import { authApiResponseToNextResponse } from "@/app/api/_utils/auth-api-response";

export const POST = apiHandler(async (request) => {
  const body = await request.json();
  const data = createTeamInvitationSchema.parse(body);

  await ensureInvitableRole(request.headers);

  const response = await callAuthApi(request.headers, "createInvitation", {
    email: data.email,
    role: buildInvitationRolePayload(),
  });
  return authApiResponseToNextResponse(response);
});
