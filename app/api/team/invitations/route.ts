import { apiHandler } from "@/lib/api/handler";
import { createTeamInvitationSchema } from "@/lib/schemas/team";
import {
  callAuthApi,
  ensureInvitableRole,
} from "@/app/(dashboard)/settings/queries";
import { authApiResponseToNextResponse } from "../_utils";

export const POST = apiHandler(async (request) => {
  const body = await request.json();
  const data = createTeamInvitationSchema.parse(body);

  await ensureInvitableRole(request.headers, data.role);

  const response = await callAuthApi(request.headers, "createInvitation", data);
  return authApiResponseToNextResponse(response);
});
