import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonNotFound, jsonSuccess } from "@/lib/api/responses";
import {
  assertPrivateBlobStorageConfigured,
  deletePrivateBlobIfConfigured,
  formatAttachmentContentDisposition,
  getPrivateBlobForDownload,
} from "@/lib/blob-storage";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { customerProjectFileRenameSchema } from "@/lib/schemas/customer-crm";
import {
  deleteCustomerProjectFile,
  getCustomerProjectFileForDownload,
  renameCustomerProjectFile,
} from "@/lib/sales/queries";

type ProjectFileRouteContext = {
  params: Promise<{ id: string; projectId: string; fileId: string }>;
};

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("sales", request.headers);
  assertPrivateBlobStorageConfigured();

  const { id, projectId, fileId } = await (ctx as ProjectFileRouteContext).params;
  const file = await getCustomerProjectFileForDownload(id, projectId, fileId);

  if (!file) {
    return jsonNotFound("File not found");
  }

  const blob = await getPrivateBlobForDownload(file.blobUrl);

  if (!blob) {
    return jsonNotFound("File not found");
  }

  return new NextResponse(blob.stream, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.sizeBytes),
      "Content-Disposition": formatAttachmentContentDisposition(file.filename),
      "Cache-Control": "private, no-store",
    },
  });
});

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const { id, projectId, fileId } = await (ctx as ProjectFileRouteContext).params;
  const data = await parseJsonBody(request, customerProjectFileRenameSchema);
  const file = await renameCustomerProjectFile(id, projectId, fileId, data);

  if (!file) {
    return jsonNotFound("File not found");
  }

  return NextResponse.json(file);
});

export const DELETE = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const { id, projectId, fileId } = await (ctx as ProjectFileRouteContext).params;
  const file = await deleteCustomerProjectFile(id, projectId, fileId);

  if (!file) {
    return jsonNotFound("File not found");
  }

  await deletePrivateBlobIfConfigured(file.blobUrl);

  return jsonSuccess();
});
