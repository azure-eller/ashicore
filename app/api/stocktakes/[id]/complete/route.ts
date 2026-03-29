import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { completeStocktakeSchema } from "@/lib/schemas/stocktakes";
import {
  completeStocktake,
  StocktakeError,
} from "@/app/(dashboard)/inventory/stocktakes/queries";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  await assertModuleWriteAccess("inventory", request.headers);
  const body = await request.json();
  const data = completeStocktakeSchema.parse(body);

  try {
    const stocktake = await completeStocktake(id, data.confirmStale);

    if (!stocktake) {
      return NextResponse.json({ error: "Stocktake not found" }, { status: 404 });
    }

    return NextResponse.json(stocktake);
  } catch (error) {
    if (error instanceof StocktakeError) return error.toResponse();
    throw error;
  }
});
