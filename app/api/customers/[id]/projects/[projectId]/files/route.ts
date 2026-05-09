import { del, put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import {
  createCustomerProjectFile,
  getCustomerProjectFileUploadTarget,
} from "@/app/(dashboard)/sales/queries";

type ProjectFilesRouteContext = {
  params: Promise<{ id: string; projectId: string }>;
};

const MAX_CUSTOMER_FILE_BYTES = 50 * 1024 * 1024;

function sanitizePathPart(value: string) {
  return value
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 140) || "file";
}

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const authContext = await assertModuleWriteAccess("sales", request.headers);

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Private file storage is not configured." },
      { status: 503 }
    );
  }

  const { id, projectId } = await (ctx as ProjectFilesRouteContext).params;
  const formData = await request.formData();
  const value = formData.get("file");

  if (!(value instanceof File)) {
    return NextResponse.json({ error: "File is required." }, { status: 400 });
  }

  if (value.size <= 0) {
    return NextResponse.json({ error: "File is empty." }, { status: 400 });
  }

  if (value.size > MAX_CUSTOMER_FILE_BYTES) {
    return NextResponse.json(
      { error: "File must be 50 MB or smaller." },
      { status: 400 }
    );
  }

  const filename = value.name || "upload";
  const project = await getCustomerProjectFileUploadTarget(id, projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const storageKey = [
    "customer-project-files",
    authContext.orgId,
    id,
    projectId,
    `${crypto.randomUUID()}-${sanitizePathPart(filename)}`,
  ].join("/");

  const blob = await put(storageKey, value, {
    access: "private",
    contentType: value.type || "application/octet-stream",
  });

  try {
    const file = await createCustomerProjectFile({
      customerId: id,
      projectId,
      storageKey,
      blobUrl: blob.url,
      filename,
      contentType: value.type || "application/octet-stream",
      sizeBytes: value.size,
      uploadedBy: {
        userId: authContext.userId,
        name: authContext.name,
      },
    });

    if (!file) {
      await del(blob.url).catch(() => undefined);
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json(file, { status: 201 });
  } catch (error) {
    await del(blob.url).catch(() => undefined);
    throw error;
  }
});
