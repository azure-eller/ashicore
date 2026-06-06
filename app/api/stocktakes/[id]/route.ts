import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonNotFound } from "@/lib/api/responses";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { updateStocktakeSchema } from "@/lib/schemas/stocktakes";
import {
  getStocktake,
  StocktakeError,
  updateStocktakeCounts,
} from "@/lib/dal/stocktakes";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  await assertModuleReadAccess("inventory", request.headers);
  const stocktake = await getStocktake(id);

  if (!stocktake) {
    return jsonNotFound("Stocktake not found");
  }

  return NextResponse.json(stocktake);
});

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  await assertModuleWriteAccess("inventory", request.headers);
  const data = await parseJsonBody(request, updateStocktakeSchema);

  try {
    const stocktake = await updateStocktakeCounts(id, data);

    if (!stocktake) {
      return jsonNotFound("Stocktake not found");
    }

    return NextResponse.json(stocktake);
  } catch (error) {
    if (error instanceof StocktakeError) return error.toResponse();
    throw error;
  }
});
