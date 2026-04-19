import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertAgentApiAccess } from "@/lib/agent/erp/access";
import { getAgentSessionSnapshot } from "@/lib/agent/erp/session-service";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

export const GET = apiHandler(async (request, context: RouteContext) => {
  const actor = await assertAgentApiAccess(request.headers);
  const { sessionId } = await context.params;
  const session = await getAgentSessionSnapshot(sessionId, {
    userId: actor.userId,
    orgId: actor.orgId,
    assignedRoles: actor.assignedRoles,
  });

  return NextResponse.json(session);
});
