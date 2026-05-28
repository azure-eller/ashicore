import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import {
  getStocktakeCompletionPreview,
  StocktakeError,
} from "@/app/(dashboard)/inventory/stocktakes/queries";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  await assertModuleReadAccess("inventory", request.headers);

  try {
    const preview = await getStocktakeCompletionPreview(id);
    if (!preview) {
      return NextResponse.json({ error: "Stocktake not found" }, { status: 404 });
    }
    return NextResponse.json(preview);
  } catch (error) {
    if (error instanceof StocktakeError) return error.toResponse();
    throw error;
  }
});
