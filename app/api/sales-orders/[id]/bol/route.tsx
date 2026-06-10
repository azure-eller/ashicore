import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { getSalesOrderForBol } from "@/lib/sales/queries";
import { BillOfLadingDocument } from "@/lib/pdf/bol-document";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  const context = await assertModuleReadAccess("sales", request.headers);

  const order = await getSalesOrderForBol(id);

  if (!order) {
    return NextResponse.json(
      { error: "Order not found or has not been shipped" },
      { status: 404 }
    );
  }

  const buffer = await renderToBuffer(
    <BillOfLadingDocument
      order={order}
      lines={order.lines}
      organizationName={context.organizationName}
    />
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="BOL-${order.orderNumber}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
});
