import { renderToBuffer } from "@react-pdf/renderer";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { pdfResponse } from "@/lib/pdf/document-response";
import { mergePdfBuffers } from "@/lib/pdf/merge";
import { SalesOrderDocument } from "@/lib/pdf/operational-documents";
import { getSalesOrder } from "@/lib/sales/queries/orders-read";
import { jsonError, jsonNotFound } from "@/lib/api/responses";

const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(50),
  template: z.enum(["sales-order", "sales-order-with-statuses", "sales-order-without-discounts", "packing-list", "packing-list-with-tracing"]).default("sales-order"),
  disposition: z.enum(["inline", "attachment"]).default("inline"),
});

export const POST = apiHandler(async (request: Request) => {
  const context = await assertModuleReadAccess("sales", request.headers);
  const input = await parseJsonBody(request, bodySchema);
  const orders = await Promise.all(input.ids.map((id) => getSalesOrder(id)));
  if (orders.some((order) => !order)) return jsonNotFound("Sales order not found");
  if (
    input.template === "packing-list-with-tracing" &&
    orders.some((order) => order!.status === "done")
  ) {
    return jsonError(
      "Completed-order lot tracing must come from shipment history. Use the standard packing list.",
      409,
    );
  }
  const buffers: Buffer[] = [];
  for (const order of orders) {
    buffers.push(await renderToBuffer(
      <SalesOrderDocument order={order!} organizationName={context.organizationName} template={input.template} />,
    ));
  }
  return pdfResponse(await mergePdfBuffers(buffers), "Sales-orders.pdf", input.disposition);
});
