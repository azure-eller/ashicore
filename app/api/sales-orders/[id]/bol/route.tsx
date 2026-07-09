import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { getSalesOrderForBol } from "@/lib/sales/queries/orders-read";
import { BillOfLadingDocument } from "@/lib/pdf/bol-document";
import { SalesError } from "@/lib/sales/queries/errors";

function selectedQuantitiesFromUrl(request: Request) {
  const url = new URL(request.url);
  const selections = new Map<string, number>();

  for (const raw of url.searchParams.getAll("line")) {
    const [lineId, quantityText, extra] = raw.split(":");
    if (!lineId || !quantityText || extra != null) {
      throw new SalesError("Invalid BOL line selection.", 400);
    }
    const quantity = Number(quantityText);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new SalesError("Selected BOL quantities must be greater than 0.", 400);
    }
    selections.set(lineId, quantity);
  }

  return selections.size > 0 ? selections : undefined;
}

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  const context = await assertModuleReadAccess("sales", request.headers);

  const order = await getSalesOrderForBol(id, {
    selectedQuantities: selectedQuantitiesFromUrl(request),
  });

  if (!order) {
    return NextResponse.json(
      { error: "Order not found" },
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
