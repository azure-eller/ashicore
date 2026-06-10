import { apiHandler } from "@/lib/api/handler";
import { jsonNotFound, jsonCreated } from "@/lib/api/responses";
import {
  assertPrivateBlobStorageConfigured,
  deletePrivateBlobQuietly,
  readRequiredPrivateFormFile,
  uploadPrivateFile,
} from "@/lib/blob-storage";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import {
  createCustomerProjectFile,
  getCustomerProjectFileUploadTarget,
} from "@/lib/sales/queries";

type ProjectFilesRouteContext = {
  params: Promise<{ id: string; projectId: string }>;
};

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const authContext = await assertModuleWriteAccess("sales", request.headers);
  assertPrivateBlobStorageConfigured();

  const { id, projectId } = await (ctx as ProjectFilesRouteContext).params;
  const uploadFile = await readRequiredPrivateFormFile(request);
  const project = await getCustomerProjectFileUploadTarget(id, projectId);
  if (!project) {
    return jsonNotFound("Project not found");
  }

  const upload = await uploadPrivateFile(uploadFile, [
    "customer-project-files",
    authContext.orgId,
    id,
    projectId,
  ]);

  try {
    const file = await createCustomerProjectFile({
      customerId: id,
      projectId,
      storageKey: upload.storageKey,
      blobUrl: upload.blobUrl,
      filename: upload.filename,
      contentType: upload.contentType,
      sizeBytes: upload.sizeBytes,
      uploadedBy: {
        userId: authContext.userId,
        name: authContext.name,
      },
    });

    if (!file) {
      await deletePrivateBlobQuietly(upload.blobUrl);
      return jsonNotFound("Project not found");
    }

    return jsonCreated(file);
  } catch (error) {
    await deletePrivateBlobQuietly(upload.blobUrl);
    throw error;
  }
});
