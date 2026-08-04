import { renderToBuffer } from "@react-pdf/renderer";
import { z } from "zod";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { getStocktake } from "@/lib/dal/stocktakes";
import { requestSearchParamRecord } from "@/lib/routing/search-params";
import { StocktakeDocument } from "@/lib/pdf/operational-documents";
import { pdfResponse, safePdfFilenameSegment } from "@/lib/pdf/document-response";
import { jsonError, jsonNotFound } from "@/lib/api/responses";

const querySchema = z.object({
  template: z.enum(["count-sheet", "reconciliation-report"]).default("count-sheet"),
  disposition: z.enum(["inline", "attachment"]).default("inline"),
});

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  const context = await assertModuleReadAccess("inventory", request.headers);
  const query = querySchema.parse(requestSearchParamRecord(request));
  const stocktake = await getStocktake(id);
  if (!stocktake) return jsonNotFound("Stocktake not found");
  if (query.template === "reconciliation-report" && stocktake.status !== "completed") {
    return jsonError("Complete the stocktake before printing its reconciliation report.", 409);
  }

  const buffer = await renderToBuffer(
    <StocktakeDocument
      stocktake={stocktake}
      organizationName={context.organizationName}
      template={query.template}
    />,
  );
  const prefix = query.template === "count-sheet" ? "Stocktake-count" : "Stocktake-reconciliation";
  return pdfResponse(
    buffer,
    `${prefix}-${safePdfFilenameSegment(stocktake.name)}.pdf`,
    query.disposition,
  );
});
