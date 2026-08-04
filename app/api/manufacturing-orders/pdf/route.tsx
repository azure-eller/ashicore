import { renderToBuffer } from "@react-pdf/renderer";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { pdfResponse } from "@/lib/pdf/document-response";
import { mergePdfBuffers } from "@/lib/pdf/merge";
import { ManufacturingOrderDocument } from "@/lib/pdf/operational-documents";
import { getManufacturingOrder } from "@/lib/manufacturing/queries/orders-read";
import { jsonNotFound } from "@/lib/api/responses";

const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(50),
  template: z.enum(["manufacturing-order", "manufacturing-order-without-costs", "manufacturing-order-notes", "manufacturing-order-partial", "manufacturing-order-partial-without-costs", "pick-list"]).default("manufacturing-order"),
  disposition: z.enum(["inline", "attachment"]).default("inline"),
});

export const POST = apiHandler(async (request: Request) => {
  const context = await assertModuleReadAccess("manufacturing", request.headers);
  const input = await parseJsonBody(request, bodySchema);
  const orders = await Promise.all(input.ids.map((id) => getManufacturingOrder(id)));
  if (orders.some((order) => !order)) return jsonNotFound("Manufacturing order not found");
  const buffers: Buffer[] = [];
  for (const order of orders) {
    buffers.push(await renderToBuffer(
      <ManufacturingOrderDocument order={order!} organizationName={context.organizationName} template={input.template} />,
    ));
  }
  return pdfResponse(await mergePdfBuffers(buffers), "Manufacturing-orders.pdf", input.disposition);
});
