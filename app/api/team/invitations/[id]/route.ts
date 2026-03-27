import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import {
  callAuthApi,
  getManageableInvitation,
} from "@/app/(dashboard)/settings/queries";
import { authApiResponseToNextResponse } from "../../_utils";

type RouteContext = { params: Promise<{ id: string }> };

export const DELETE = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  const invite = await getManageableInvitation(request.headers, id);

  if (!invite) {
    return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  }

  const response = await callAuthApi(request.headers, "cancelInvitation", {
    invitationId: id,
  });

  return authApiResponseToNextResponse(response);
});
