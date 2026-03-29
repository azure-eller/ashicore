import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { updateStocktakeCountsSchema } from "@/lib/schemas/stocktakes";
import {
  getStocktake,
  StocktakeError,
  updateStocktakeCounts,
} from "@/app/(dashboard)/inventory/stocktakes/queries";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  await assertModuleReadAccess("inventory", request.headers);
  const stocktake = await getStocktake(id);

  if (!stocktake) {
    return NextResponse.json({ error: "Stocktake not found" }, { status: 404 });
  }

  return NextResponse.json(stocktake);
});

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  await assertModuleWriteAccess("inventory", request.headers);
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
