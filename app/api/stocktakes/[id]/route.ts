import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { updateStocktakeCountsSchema } from "@/lib/schemas/stocktakes";
import {
  getStocktake,
  StocktakeError,
  updateStocktakeCounts,
} from "@/app/(dashboard)/inventory/stocktakes/queries";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (_request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  const stocktake = await getStocktake(id);

  if (!stocktake) {
    return NextResponse.json({ error: "Stocktake not found" }, { status: 404 });
  }

  return NextResponse.json(stocktake);
});

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  const body = await request.json();
  const data = updateStocktakeCountsSchema.parse(body);

  try {
    const stocktake = await updateStocktakeCounts(id, data);

    if (!stocktake) {
      return NextResponse.json({ error: "Stocktake not found" }, { status: 404 });
    }

    return NextResponse.json(stocktake);
  } catch (error) {
    if (error instanceof StocktakeError) return error.toResponse();
    throw error;
  }
});
