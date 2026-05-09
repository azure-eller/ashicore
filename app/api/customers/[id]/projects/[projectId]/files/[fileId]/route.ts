import { del, get } from "@vercel/blob";
import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { customerProjectFileRenameSchema } from "@/lib/schemas/customer-crm";
import {
  deleteCustomerProjectFile,
  getCustomerProjectFileForDownload,
  renameCustomerProjectFile,
} from "@/app/(dashboard)/sales/queries";

type ProjectFileRouteContext = {
  params: Promise<{ id: string; projectId: string; fileId: string }>;
};

function contentDisposition(filename: string) {
  const fallback = filename.replace(/["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("sales", request.headers);

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Private file storage is not configured." },
      { status: 503 }
    );
  }

  const { id, projectId, fileId } = await (ctx as ProjectFileRouteContext).params;
  const file = await getCustomerProjectFileForDownload(id, projectId, fileId);

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

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const { id, projectId, fileId } = await (ctx as ProjectFileRouteContext).params;
  const data = customerProjectFileRenameSchema.parse(await request.json());
  const file = await renameCustomerProjectFile(id, projectId, fileId, data);

  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  return NextResponse.json(file);
});

export const DELETE = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const { id, projectId, fileId } = await (ctx as ProjectFileRouteContext).params;
  const file = await deleteCustomerProjectFile(id, projectId, fileId);

  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    await del(file.blobUrl).catch(() => undefined);
  }

  return NextResponse.json({ success: true });
});
