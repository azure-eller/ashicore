import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertAgentApiAccess } from "@/lib/agent/erp/access";
import { createAgentUploads } from "@/lib/agent/erp/session-service";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

export const POST = apiHandler(async (request, context: RouteContext) => {
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
