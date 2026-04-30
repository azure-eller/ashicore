import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { getSalesShipmentForBol } from "@/app/(dashboard)/sales/queries";
import { BillOfLadingDocument } from "@/lib/pdf/bol-document";

type ShipmentRouteContext = { params: Promise<{ id: string; shipmentId: string }> };

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  const { id, shipmentId } = await (ctx as ShipmentRouteContext).params;
  const context = await assertModuleReadAccess("sales", request.headers);

  const shipment = await getSalesShipmentForBol(id, shipmentId);

  if (!shipment) {
    return NextResponse.json(
      { error: "Shipment not found or cannot produce a BOL" },
      { status: 404 }
    );
  }

  const buffer = await renderToBuffer(
    <BillOfLadingDocument
      order={shipment}
      lines={shipment.lines}
      organizationName={context.organizationName}
    />
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="BOL-${shipment.shipmentNumber}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
});
