import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { createStocktakeSchema } from "@/lib/schemas/stocktakes";
import { bulkDeleteSchema } from "@/lib/schemas/shared";
import {
  createStocktake,
  deleteStocktakes,
  getStocktakes,
  StocktakeError,
} from "@/app/(dashboard)/inventory/stocktakes/queries";

export const GET = apiHandler(async (request) => {
  await assertModuleReadAccess("inventory", request.headers);
  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? Math.min(Math.max(Number(limitParam) || 25, 1), 100) : null;
  const data = await getStocktakes({
    search: searchParams.get("search"),
    limit,
  });
  return NextResponse.json(data);
});

export const DELETE = apiHandler(async (request) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const body = await request.json();
  const { ids } = bulkDeleteSchema.parse(body);
  const result = await deleteStocktakes(ids);

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result);
});

export const POST = apiHandler(async (request) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const body = await request.json();
  const data = createStocktakeSchema.parse(body);

  try {
    const stocktake = await createStocktake(data);
    return NextResponse.json(stocktake, { status: 201 });
  } catch (error) {
    if (error instanceof StocktakeError) return error.toResponse();
    throw error;
  }
});
