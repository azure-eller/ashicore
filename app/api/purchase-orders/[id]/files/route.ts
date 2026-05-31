import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { jsonNotFound, jsonCreated } from "@/lib/api/responses";
import {
  assertPrivateBlobStorageConfigured,
  deletePrivateBlobQuietly,
  readRequiredPrivateFormFile,
  uploadPrivateFile,
} from "@/lib/blob-storage";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import {
  createPurchaseOrderAttachment,
  getPurchaseOrderFileUploadTarget,
} from "@/app/(dashboard)/purchasing/queries";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const authContext = await assertModuleWriteAccess("purchasing", request.headers);
  assertPrivateBlobStorageConfigured();

  const { id } = await (ctx as RouteContext).params;
  const uploadFile = await readRequiredPrivateFormFile(request);

  const order = await getPurchaseOrderFileUploadTarget(id);
  if (!order) {
    return jsonNotFound("Purchase order not found");
  }

  const upload = await uploadPrivateFile(uploadFile, [
    "attachments",
    authContext.orgId,
    "purchase-orders",
    id,
  ]);

  try {
    const file = await createPurchaseOrderAttachment({
      purchaseOrderId: id,
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
      return jsonNotFound("Purchase order not found");
    }

    return jsonCreated(file);
  } catch (error) {
    await deletePrivateBlobQuietly(upload.blobUrl);
    throw error;
  }
});
