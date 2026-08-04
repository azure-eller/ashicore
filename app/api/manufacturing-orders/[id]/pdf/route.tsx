import { renderToBuffer } from "@react-pdf/renderer";
import { z } from "zod";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { getManufacturingOrder } from "@/lib/manufacturing/queries/orders-read";
import { requestSearchParamRecord } from "@/lib/routing/search-params";
import { ManufacturingOrderDocument } from "@/lib/pdf/operational-documents";
import { pdfResponse, safePdfFilenameSegment } from "@/lib/pdf/document-response";
import { jsonNotFound } from "@/lib/api/responses";

const querySchema = z.object({
  template: z.enum([
    "manufacturing-order",
    "manufacturing-order-without-costs",
    "manufacturing-order-notes",
    "manufacturing-order-partial",
    "manufacturing-order-partial-without-costs",
    "pick-list",
  ]).default("manufacturing-order"),
  disposition: z.enum(["inline", "attachment"]).default("inline"),
});

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  const context = await assertModuleReadAccess("manufacturing", request.headers);
  const query = querySchema.parse(requestSearchParamRecord(request));
  const order = await getManufacturingOrder(id);
  if (!order) return jsonNotFound("Manufacturing order not found");

  const buffer = await renderToBuffer(
    <ManufacturingOrderDocument
      order={order}
      organizationName={context.organizationName}
      template={query.template}
    />,
  );
  const prefix = query.template === "pick-list" ? "Pick-list" : "Manufacturing-order";
  return pdfResponse(
    buffer,
    `${prefix}-${safePdfFilenameSegment(order.orderNumber)}.pdf`,
    query.disposition,
  );
});
