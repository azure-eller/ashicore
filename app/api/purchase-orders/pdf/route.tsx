import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { pdfResponse } from "@/lib/pdf/document-response";
import { mergePdfBuffers } from "@/lib/pdf/merge";
import { renderPurchaseOrderPdfBuffers } from "@/lib/purchasing/send-purchase-order-email";
import { jsonNotFound } from "@/lib/api/responses";

const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(50),
  template: z.enum(["purchase-order", "request-for-quote", "put-away-list"]).default("purchase-order"),
  disposition: z.enum(["inline", "attachment"]).default("inline"),
});

export const POST = apiHandler(async (request: Request) => {
  const context = await assertModuleReadAccess("purchasing", request.headers);
  const input = await parseJsonBody(request, bodySchema);
  const buffers = [];
  for (const id of input.ids) {
    const orderBuffers = await renderPurchaseOrderPdfBuffers(
      context.orgId,
      id,
      input.template,
    );
    if (!orderBuffers) {
      return jsonNotFound("Purchase order not found");
    }
    buffers.push(...orderBuffers);
  }
  return pdfResponse(
    await mergePdfBuffers(buffers.map((result) => result.buffer)),
    "Purchase-orders.pdf",
    input.disposition,
  );
});
