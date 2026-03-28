import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { apiHandler } from "@/lib/api/handler";
import { insertStocktakeSchema } from "@/lib/schemas/stocktakes";
import {
  createStocktake,
  deleteStocktakes,
  getStocktakes,
  StocktakeError,
} from "@/app/(dashboard)/inventory/stocktakes/queries";

const deleteStocktakesSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

export async function GET() {
  const data = await getStocktakes();
  return NextResponse.json(data);
}

export const DELETE = apiHandler(async (request) => {
  const body = await request.json();
  const { ids } = deleteStocktakesSchema.parse(body);
  const result = await deleteStocktakes(ids);

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result);
});

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
