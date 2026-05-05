import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { isErpAgentEnabled } from "@/lib/feature-flags";

export const runtime = "nodejs";

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export const GET = apiHandler(async (request) => {
  if (!isErpAgentEnabled()) {
    return notFound();
  }

  const [{ assertAgentApiAccess }, { listAgentSessionsForUser }] =
    await Promise.all([
      import("@/lib/agent/erp/access"),
      import("@/lib/agent/erp/session-summary-service"),
    ]);
  const actor = await assertAgentApiAccess(request.headers);
  const sessions = await listAgentSessionsForUser({
    userId: actor.userId,
    orgId: actor.orgId,
    assignedRoles: actor.assignedRoles,
  });

  return NextResponse.json({ sessions });
});

export const POST = apiHandler(async (request) => {
  if (!isErpAgentEnabled()) {
    return notFound();
  }

  const [{ assertAgentApiAccess }, { createAgentSession }] = await Promise.all([
    import("@/lib/agent/erp/access"),
    import("@/lib/agent/erp/session-summary-service"),
  ]);
  const actor = await assertAgentApiAccess(request.headers);
  const session = await createAgentSession({
    userId: actor.userId,
    orgId: actor.orgId,
    assignedRoles: actor.assignedRoles,
  });

  return NextResponse.json(session, { status: 201 });
});
