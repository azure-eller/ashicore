import { apiHandler } from "@/lib/api/handler";
import { jsonNotFound, jsonSuccess } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { deleteCustomerProjectNote } from "@/app/(dashboard)/sales/queries";

type ProjectNoteRouteContext = {
  params: Promise<{ id: string; projectId: string; noteId: string }>;
};

export const DELETE = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const { id, projectId, noteId } = await (ctx as ProjectNoteRouteContext).params;
  const result = await deleteCustomerProjectNote(id, projectId, noteId);

  if (!result.deleted) {
    return jsonNotFound("Note not found");
  }

  return jsonSuccess();
});
