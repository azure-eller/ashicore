import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonNotFound } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { completeStocktakeSchema } from "@/lib/schemas/stocktakes";
import {
  completeStocktake,
  StocktakeError,
} from "@/lib/dal/stocktakes";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  await assertModuleWriteAccess("inventory", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "completeStocktake");
  const data = await parseJsonBody(request, completeStocktakeSchema);

  try {
    const stocktake = await completeStocktake(id, data.confirmStale, {
      idempotencyKey,
      reason: data.reason,
    });

    if (!stocktake) {
      return jsonNotFound("Stocktake not found");
    }

    return NextResponse.json(stocktake);
  } catch (error) {
    if (error instanceof StocktakeError) return error.toResponse();
    throw error;
  }
});
