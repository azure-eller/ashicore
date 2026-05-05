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

export const POST = apiHandler(async (request, context: RouteContext) => {
  if (!isErpAgentEnabled()) {
    return notFound();
  }

  const [{ assertAgentApiAccess }, { createAgentUploads }] = await Promise.all([
    import("@/lib/agent/erp/access"),
    import("@/lib/agent/erp/session-service"),
  ]);
  const actor = await assertAgentApiAccess(request.headers);
  const { sessionId } = await context.params;
  const formData = await request.formData();
  const files = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File && value.size > 0);

  if (files.length === 0) {
    return NextResponse.json({ error: "No files uploaded." }, { status: 400 });
  }

  const uploads = await createAgentUploads({
    sessionId,
    actor: {
      userId: actor.userId,
      orgId: actor.orgId,
      assignedRoles: actor.assignedRoles,
    },
    files,
  });

  return NextResponse.json({ uploads }, { status: 201 });
});
