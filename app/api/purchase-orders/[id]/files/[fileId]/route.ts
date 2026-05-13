import { del, get } from "@vercel/blob";
import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import {
  deletePurchaseOrderAttachment,
  getPurchaseOrderAttachmentForDownload,
} from "@/app/(dashboard)/purchasing/queries";

type PurchaseOrderFileRouteContext = {
  params: Promise<{ id: string; fileId: string }>;
};

function contentDisposition(filename: string) {
  const fallback = filename.replace(/["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("purchasing", request.headers);

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Private file storage is not configured." },
      { status: 503 }
    );
  }

  const { id, fileId } = await (ctx as PurchaseOrderFileRouteContext).params;
  const file = await getPurchaseOrderAttachmentForDownload(id, fileId);

  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const blob = await get(file.blobUrl, { access: "private" });

  if (!blob || blob.statusCode !== 200 || !blob.stream) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  return new NextResponse(blob.stream, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.sizeBytes),
      "Content-Disposition": contentDisposition(file.filename),
      "Cache-Control": "private, no-store",
    },
  });
});

export const DELETE = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const { id, fileId } = await (ctx as PurchaseOrderFileRouteContext).params;
  const file = await deletePurchaseOrderAttachment(id, fileId);

  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    await del(file.blobUrl).catch(() => undefined);
  }

  return NextResponse.json({ success: true });
});
