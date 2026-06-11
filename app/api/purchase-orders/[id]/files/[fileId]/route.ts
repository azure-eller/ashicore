import { del } from "@vercel/blob";
import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { jsonNotFound, jsonSuccess } from "@/lib/api/responses";
import {
  formatAttachmentContentDisposition,
  getPrivateBlobForDownload,
} from "@/lib/blob-storage";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { deletePurchaseOrderAttachment, getPurchaseOrderAttachmentForDownload } from "@/lib/purchasing/queries/attachments";
import {
  deleteLocalAttachment,
  isLocalAttachmentUrl,
  readLocalAttachment,
} from "@/lib/attachments/local-file-storage";
import { DomainError } from "@/lib/errors/domain-error";
import { env } from "@/lib/env";

type PurchaseOrderFileRouteContext = {
  params: Promise<{ id: string; fileId: string }>;
};

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("purchasing", request.headers);

  const { id, fileId } = await (ctx as PurchaseOrderFileRouteContext).params;
  const file = await getPurchaseOrderAttachmentForDownload(id, fileId);

  if (!file) {
    return jsonNotFound("File not found");
  }

  if (isLocalAttachmentUrl(file.blobUrl)) {
    const buffer = await readLocalAttachment(file.blobUrl);
    if (!buffer) {
      return jsonNotFound("File not found");
    }

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(buffer.byteLength),
        "Content-Disposition": formatAttachmentContentDisposition(file.filename),
        "Cache-Control": "private, no-store",
      },
    });
  }

  if (!env.BLOB_READ_WRITE_TOKEN) {
    throw new DomainError("Private file storage is not configured.", 503);
  }

  const blob = await getPrivateBlobForDownload(file.blobUrl);

  if (!blob) {
    return jsonNotFound("File not found");
  }

  return new NextResponse(blob.stream, {
    headers: {
      "Content-Type": file.contentType,
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

  if (isLocalAttachmentUrl(file.blobUrl)) {
    await deleteLocalAttachment(file.blobUrl).catch(() => undefined);
  } else if (env.BLOB_READ_WRITE_TOKEN) {
    await del(file.blobUrl).catch(() => undefined);
  }

  return jsonSuccess();
});
