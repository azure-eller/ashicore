import { renderToBuffer } from "@react-pdf/renderer";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { getStocktake } from "@/lib/dal/stocktakes";
import { pdfResponse } from "@/lib/pdf/document-response";
import { mergePdfBuffers } from "@/lib/pdf/merge";
import { StocktakeDocument } from "@/lib/pdf/operational-documents";
import { jsonError, jsonNotFound } from "@/lib/api/responses";

const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(50),
  template: z.enum(["count-sheet", "reconciliation-report"]).default("count-sheet"),
  disposition: z.enum(["inline", "attachment"]).default("inline"),
});

export const POST = apiHandler(async (request: Request) => {
  const context = await assertModuleReadAccess("inventory", request.headers);
  const input = await parseJsonBody(request, bodySchema);
  const stocktakes = await Promise.all(input.ids.map((id) => getStocktake(id)));
  if (stocktakes.some((stocktake) => !stocktake)) return jsonNotFound("Stocktake not found");
  if (input.template === "reconciliation-report" && stocktakes.some((stocktake) => stocktake!.status !== "completed")) {
    return jsonError("Complete every selected stocktake before printing reconciliation reports.", 409);
  }
  const buffers: Buffer[] = [];
  for (const stocktake of stocktakes) {
    buffers.push(await renderToBuffer(
      <StocktakeDocument stocktake={stocktake!} organizationName={context.organizationName} template={input.template} />,
    ));
  }
  return pdfResponse(await mergePdfBuffers(buffers), "Stocktakes.pdf", input.disposition);
});
