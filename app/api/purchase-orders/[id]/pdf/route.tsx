import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { renderPurchaseOrderPdfBuffer } from "@/lib/purchasing/send-purchase-order-email";
import { renderPurchaseOrderPdfBuffers } from "@/lib/purchasing/send-purchase-order-email";
import { pdfResponse } from "@/lib/pdf/document-response";
import { mergePdfBuffers } from "@/lib/pdf/merge";
import { requestSearchParamRecord } from "@/lib/routing/search-params";
import { z } from "zod";

const querySchema = z.object({
  groupKey: z.string().trim().min(1).optional(),
  template: z
    .enum(["purchase-order", "request-for-quote", "put-away-list"])
    .default("purchase-order"),
  disposition: z.enum(["inline", "attachment"]).default("inline"),
});

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  const context = await assertModuleReadAccess("purchasing", request.headers);
  const query = querySchema.parse(requestSearchParamRecord(request));

  const selectedResult = query.groupKey
    ? await renderPurchaseOrderPdfBuffer(
        context.orgId,
        id,
        query.groupKey,
        query.template,
      )
    : null;
  const results = query.groupKey
    ? selectedResult
      ? [selectedResult]
      : null
    : await renderPurchaseOrderPdfBuffers(context.orgId, id, query.template);
  if (!results?.length) {
    return NextResponse.json(
      { error: "Purchase order not found" },
      { status: 404 },
    );
  }

  const buffer =
    results.length === 1
      ? results[0].buffer
      : await mergePdfBuffers(results.map((result) => result.buffer));
  return pdfResponse(
    buffer,
    `${results[0].orderNumber}.pdf`,
    query.disposition,
  );
});
