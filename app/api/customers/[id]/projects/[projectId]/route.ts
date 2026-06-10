import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonNotFound, jsonSuccess } from "@/lib/api/responses";
import { deletePrivateBlobsIfConfigured } from "@/lib/blob-storage";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { customerProjectSchema } from "@/lib/schemas/customer-crm";
import { deleteCustomerProject, updateCustomerProject } from "@/lib/sales/queries/crm";

type ProjectRouteContext = {
  params: Promise<{ id: string; projectId: string }>;
};

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const { id, projectId } = await (ctx as ProjectRouteContext).params;
  const data = await parseJsonBody(request, customerProjectSchema);
  const project = await updateCustomerProject(id, projectId, data);

  if (!project) {
    return jsonNotFound("Project not found");
  }

  return NextResponse.json(project);
});

export const DELETE = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const { id, projectId } = await (ctx as ProjectRouteContext).params;
  const result = await deleteCustomerProject(id, projectId);

  if (!result.deleted) {
    return jsonNotFound("Project not found");
  }

  await deletePrivateBlobsIfConfigured(result.blobUrls);

  return jsonSuccess();
});
