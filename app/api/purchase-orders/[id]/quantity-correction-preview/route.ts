import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { jsonNotFound } from "@/lib/api/responses";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { getPurchaseOrderQuantityCorrectionImpact } from "@/lib/purchasing/queries/quantity-correction";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("purchasing", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const url = new URL(request.url);
  const lineId = url.searchParams.get("lineId") ?? "";
  const quantityOrdered = url.searchParams.get("quantityOrdered") ?? "";
  const impact = await getPurchaseOrderQuantityCorrectionImpact(
    id,
    lineId,
    quantityOrdered,
  );
  if (!impact) return jsonNotFound("Purchase order not found");
  return NextResponse.json(impact);
});
