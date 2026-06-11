import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { jsonCreated, jsonNotFound } from "@/lib/api/responses";
import {
  deletePrivateBlobQuietly,
  readRequiredPrivateFormFile,
  sanitizeBlobPathPart,
  uploadPrivateFile,
} from "@/lib/blob-storage";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { DomainError } from "@/lib/errors/domain-error";
import { createPurchaseOrderAttachment, getPurchaseOrderFileUploadTarget } from "@/lib/purchasing/queries/attachments";
import {
  canUseLocalAttachmentStorage,
  deleteLocalAttachment,
  writeLocalAttachment,
} from "@/lib/attachments/local-file-storage";
import { env } from "@/lib/env";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const authContext = await assertModuleWriteAccess("purchasing", request.headers);
  const useBlobStorage = Boolean(env.BLOB_READ_WRITE_TOKEN);

  if (!useBlobStorage && !canUseLocalAttachmentStorage()) {
    throw new DomainError("Private file storage is not configured.", 503);
  }

  const { id } = await (ctx as RouteContext).params;
  const uploadFile = await readRequiredPrivateFormFile(request);

  const order = await getPurchaseOrderFileUploadTarget(id);
  if (!order) {
    return jsonNotFound("Purchase order not found");
  }

  const upload = useBlobStorage
    ? await uploadPrivateFile(uploadFile, [
        "attachments",
        authContext.orgId,
        "purchase-orders",
        id,
      ])
    : {
        ...uploadFile,
        storageKey: [
          "attachments",
          authContext.orgId,
          "purchase-orders",
          id,
          `${crypto.randomUUID()}-${sanitizeBlobPathPart(uploadFile.filename)}`,
        ].join("/"),
        blobUrl: "",
      };

  if (!useBlobStorage) {
    upload.blobUrl = await writeLocalAttachment(upload.storageKey, uploadFile.file);
  }

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
      if (useBlobStorage) {
        await deletePrivateBlobQuietly(upload.blobUrl);
      } else {
        await deleteLocalAttachment(upload.blobUrl).catch(() => undefined);
      }
      return jsonNotFound("Purchase order not found");
    }

    return jsonCreated(file);
  } catch (error) {
    if (useBlobStorage) {
      await deletePrivateBlobQuietly(upload.blobUrl);
    } else {
      await deleteLocalAttachment(upload.blobUrl).catch(() => undefined);
    }
    throw error;
  }
});
