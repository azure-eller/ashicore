import { del, put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import {
  createPurchaseOrderAttachment,
  getPurchaseOrderFileUploadTarget,
} from "@/app/(dashboard)/purchasing/queries";

const MAX_PURCHASE_ORDER_FILE_BYTES = 50 * 1024 * 1024;

function sanitizePathPart(value: string) {
  return (
    value
      .trim()
      .replace(/[/\\?%*:|"<>]/g, "-")
      .replace(/\s+/g, "-")
      .slice(0, 140) || "file"
  );
}

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const authContext = await assertModuleWriteAccess("purchasing", request.headers);

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Private file storage is not configured." },
      { status: 503 }
    );
  }

  const { id } = await (ctx as RouteContext).params;
  const formData = await request.formData();
  const value = formData.get("file");

  if (!(value instanceof File)) {
    return NextResponse.json({ error: "File is required." }, { status: 400 });
  }

  if (value.size <= 0) {
    return NextResponse.json({ error: "File is empty." }, { status: 400 });
  }

  if (value.size > MAX_PURCHASE_ORDER_FILE_BYTES) {
    return NextResponse.json(
      { error: "File must be 50 MB or smaller." },
      { status: 400 }
    );
  }

  const order = await getPurchaseOrderFileUploadTarget(id);
  if (!order) {
    return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
  }

  const filename = value.name || "upload";
  const storageKey = [
    "attachments",
    authContext.orgId,
    "purchase-orders",
    id,
    `${crypto.randomUUID()}-${sanitizePathPart(filename)}`,
  ].join("/");

  const blob = await put(storageKey, value, {
    access: "private",
    contentType: value.type || "application/octet-stream",
  });

  try {
    const file = await createPurchaseOrderAttachment({
      purchaseOrderId: id,
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
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    }

    return NextResponse.json(file, { status: 201 });
  } catch (error) {
    await del(blob.url).catch(() => undefined);
    throw error;
  }
});
