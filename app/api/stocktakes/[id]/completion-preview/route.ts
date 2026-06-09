import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { jsonNotFound } from "@/lib/api/responses";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { getStocktakeCompletionPreview } from "@/lib/dal/stocktakes";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  await assertModuleReadAccess("inventory", request.headers);

  const preview = await getStocktakeCompletionPreview(id);
  if (!preview) {
    return jsonNotFound("Stocktake not found");
  }
  return NextResponse.json(preview);
});
