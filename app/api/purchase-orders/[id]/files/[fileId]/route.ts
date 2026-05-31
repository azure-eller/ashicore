import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { jsonNotFound, jsonSuccess } from "@/lib/api/responses";
import {
  assertPrivateBlobStorageConfigured,
  deletePrivateBlobIfConfigured,
  formatAttachmentContentDisposition,
  getPrivateBlobForDownload,
} from "@/lib/blob-storage";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import {
  deletePurchaseOrderAttachment,
  getPurchaseOrderAttachmentForDownload,
} from "@/app/(dashboard)/purchasing/queries";

type PurchaseOrderFileRouteContext = {
  params: Promise<{ id: string; fileId: string }>;
};

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("purchasing", request.headers);
  assertPrivateBlobStorageConfigured();

  const { id, fileId } = await (ctx as PurchaseOrderFileRouteContext).params;
  const file = await getPurchaseOrderAttachmentForDownload(id, fileId);

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

export const DELETE = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const { id, fileId } = await (ctx as PurchaseOrderFileRouteContext).params;
  const file = await deletePurchaseOrderAttachment(id, fileId);

  if (!file) {
    return jsonNotFound("File not found");
  }

  await deletePrivateBlobIfConfigured(file.blobUrl);

  return jsonSuccess();
});
