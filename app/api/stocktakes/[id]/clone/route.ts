import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import {
  cloneStocktake,
  StocktakeError,
} from "@/app/(dashboard)/inventory/stocktakes/queries";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  await assertModuleWriteAccess("inventory", request.headers);

  try {
    const stocktake = await cloneStocktake(id);

    if (!stocktake) {
      return NextResponse.json({ error: "Stocktake not found" }, { status: 404 });
    }

    return NextResponse.json(stocktake, { status: 201 });
  } catch (error) {
    if (error instanceof StocktakeError) return error.toResponse();
    throw error;
  }
});
