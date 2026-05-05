import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { isErpAgentEnabled } from "@/lib/feature-flags";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export const GET = apiHandler(async (request, context: RouteContext) => {
  if (!isErpAgentEnabled()) {
    return notFound();
  }

  const [{ assertAgentApiAccess }, { getAgentSessionSnapshot }] =
    await Promise.all([
      import("@/lib/agent/erp/access"),
      import("@/lib/agent/erp/session-summary-service"),
    ]);
  const actor = await assertAgentApiAccess(request.headers);
  const { sessionId } = await context.params;
  const session = await getAgentSessionSnapshot(sessionId, {
    userId: actor.userId,
    orgId: actor.orgId,
    assignedRoles: actor.assignedRoles,
  });

  return NextResponse.json(session);
});
