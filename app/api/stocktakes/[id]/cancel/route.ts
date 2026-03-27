import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import {
  cancelStocktake,
  StocktakeError,
} from "@/app/(dashboard)/inventory/stocktakes/queries";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = apiHandler(async (_request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;

  try {
    const stocktake = await cancelStocktake(id);

    if (!stocktake) {
      return NextResponse.json({ error: "Stocktake not found" }, { status: 404 });
    }

    return NextResponse.json(stocktake);
  } catch (error) {
    if (error instanceof StocktakeError) return error.toResponse();
    throw error;
  }
});
