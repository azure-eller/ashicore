import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonCreated, jsonNotFound } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { customerProjectNoteSchema } from "@/lib/schemas/customer-crm";
import { createCustomerProjectNote } from "@/app/(dashboard)/sales/queries";

type ProjectNotesRouteContext = {
  params: Promise<{ id: string; projectId: string }>;
};

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const authContext = await assertModuleWriteAccess("sales", request.headers);
  const { id, projectId } = await (ctx as ProjectNotesRouteContext).params;
  const data = await parseJsonBody(request, customerProjectNoteSchema);
  const note = await createCustomerProjectNote(id, projectId, data, {
    userId: authContext.userId,
    name: authContext.name,
  });

  if (!note) {
    return jsonNotFound("Project not found");
  }

  return jsonCreated(note);
});
