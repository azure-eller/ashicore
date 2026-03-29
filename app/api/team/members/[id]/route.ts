import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { updateTeamMemberRoleSchema } from "@/lib/schemas/team";
import {
  callAuthApi,
  ensureInvitableRole,
  getManageableMember,
} from "@/app/(dashboard)/settings/queries";
import { authApiResponseToNextResponse } from "@/app/api/_utils/auth-api-response";


export const PATCH = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  const body = await request.json();
  const data = updateTeamMemberRoleSchema.parse(body);
  const member = await getManageableMember(request.headers, id);

  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  await ensureInvitableRole(request.headers, data.role);

  const response = await callAuthApi(request.headers, "updateMemberRole", {
    memberId: id,
    role: data.role,
  });

  return authApiResponseToNextResponse(response);
});

export const DELETE = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  const member = await getManageableMember(request.headers, id);

  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const response = await callAuthApi(request.headers, "removeMember", {
    memberIdOrEmail: id,
  });

  return authApiResponseToNextResponse(response);
});
