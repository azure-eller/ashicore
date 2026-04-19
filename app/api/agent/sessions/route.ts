import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertAgentApiAccess } from "@/lib/agent/erp/access";
import { createAgentSession, listAgentSessionsForUser } from "@/lib/agent/erp/session-service";

export const runtime = "nodejs";

export const GET = apiHandler(async (request) => {
  const actor = await assertAgentApiAccess(request.headers);
  const sessions = await listAgentSessionsForUser({
    userId: actor.userId,
    orgId: actor.orgId,
    assignedRoles: actor.assignedRoles,
  });

  return NextResponse.json({ sessions });
});

export const POST = apiHandler(async (request) => {
  const actor = await assertAgentApiAccess(request.headers);
  const session = await createAgentSession({
    userId: actor.userId,
    orgId: actor.orgId,
    assignedRoles: actor.assignedRoles,
  });

  return NextResponse.json(session, { status: 201 });
});
