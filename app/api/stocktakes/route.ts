import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { insertStocktakeSchema } from "@/lib/schemas/stocktakes";
import {
  createStocktake,
  getStocktakes,
  StocktakeError,
} from "@/app/(dashboard)/inventory/stocktakes/queries";

export async function GET() {
  const data = await getStocktakes();
  return NextResponse.json(data);
}

export const POST = apiHandler(async (request) => {
  const body = await request.json();
  const data = insertStocktakeSchema.parse(body);

  try {
    const stocktake = await createStocktake(data);
    return NextResponse.json(stocktake, { status: 201 });
  } catch (error) {
    if (error instanceof StocktakeError) return error.toResponse();
    throw error;
  }
});
