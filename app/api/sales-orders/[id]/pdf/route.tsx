import { renderToBuffer } from "@react-pdf/renderer";
import { z } from "zod";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { getSalesOrder } from "@/lib/sales/queries/orders-read";
import { requestSearchParamRecord } from "@/lib/routing/search-params";
import { SalesOrderDocument } from "@/lib/pdf/operational-documents";
import { pdfResponse, safePdfFilenameSegment } from "@/lib/pdf/document-response";
import { jsonError, jsonNotFound } from "@/lib/api/responses";

const querySchema = z.object({
  template: z.enum([
    "sales-order",
    "sales-order-with-statuses",
    "sales-order-without-discounts",
    "packing-list",
    "packing-list-with-tracing",
  ]).default("sales-order"),
  disposition: z.enum(["inline", "attachment"]).default("inline"),
});

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  const context = await assertModuleReadAccess("sales", request.headers);
  const query = querySchema.parse(requestSearchParamRecord(request));
  const order = await getSalesOrder(id);
  if (!order) return jsonNotFound("Sales order not found");
  if (query.template === "packing-list-with-tracing" && order.status === "done") {
    return jsonError(
      "Completed-order lot tracing must come from shipment history. Use the standard packing list.",
      409,
    );
  }

  const buffer = await renderToBuffer(
    <SalesOrderDocument
      order={order}
      organizationName={context.organizationName}
      template={query.template}
    />,
  );
  const prefix = query.template.startsWith("packing-list") ? "Packing-list" : "Sales-order";
  return pdfResponse(
    buffer,
    `${prefix}-${safePdfFilenameSegment(order.orderNumber)}.pdf`,
    query.disposition,
  );
});
