import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { jsonNotFound } from "@/lib/api/responses";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { getPurchaseOrderDeleteImpact } from "@/lib/purchasing/queries/orders-read";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("purchasing", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const impact = await getPurchaseOrderDeleteImpact(id);

  if (!impact) {
    return jsonNotFound("Purchase order not found");
  }

  return NextResponse.json(impact);
});
