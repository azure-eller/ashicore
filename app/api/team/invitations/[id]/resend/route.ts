import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import {
  buildInvitationRolePayload,
  callAuthApi,
  getManageableInvitation,
} from "@/app/(dashboard)/settings/queries";
import { authApiResponseToNextResponse } from "@/app/api/_utils/auth-api-response";


export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  const invite = await getManageableInvitation(request.headers, id);

  if (!invite) {
    return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  }

  const response = await callAuthApi(request.headers, "createInvitation", {
    email: invite.invitation.email,
    role: buildInvitationRolePayload(),
    resend: true,
  });

  return authApiResponseToNextResponse(response);
});
