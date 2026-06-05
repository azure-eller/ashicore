import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { formatAttachmentContentDisposition } from "@/lib/blob-storage";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { renderPurchaseOrderPdfBuffer } from "@/lib/purchasing/send-purchase-order-email";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  const context = await assertModuleReadAccess("purchasing", request.headers);
  const groupKey = new URL(request.url).searchParams.get("groupKey");

  const result = await renderPurchaseOrderPdfBuffer(context.orgId, id, groupKey);
  if (!result) {
    return NextResponse.json(
      { error: "Purchase order not found" },
      { status: 404 },
    );
  }

  return new NextResponse(new Uint8Array(result.buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": formatAttachmentContentDisposition(
        `${result.orderNumber}.pdf`,
      ).replace(/^attachment/, "inline"),
      "cache-control": "private, no-store",
    },
  });
});
