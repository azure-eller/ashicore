import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { jsonNotFound } from "@/lib/api/responses";
import {
  callAuthApi,
  getManageableInvitation,
} from "@/app/(dashboard)/settings/queries";
import { authApiResponseToNextResponse } from "@/app/api/_utils/auth-api-response";
import { splitAssignedRoles } from "@/lib/authz";


export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  const invite = await getManageableInvitation(request.headers, id);

  if (!invite) {
    return jsonNotFound("Invitation not found");
  }

  const response = await callAuthApi(request.headers, "createInvitation", {
    email: invite.invitation.email,
    role: splitAssignedRoles(invite.invitation.role),
    resend: true,
  });

  return authApiResponseToNextResponse(response);
});
