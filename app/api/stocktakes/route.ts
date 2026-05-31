import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonError, jsonCreated } from "@/lib/api/responses";
import { requestSearchParams } from "@/lib/routing/search-params";
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
  const searchParams = requestSearchParams(request);
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
  const { ids } = await parseJsonBody(request, bulkDeleteSchema);
  const result = await deleteStocktakes(ids);

  if (result.error) {
    return jsonError(result.error);
  }

  return NextResponse.json(result);
});

export const POST = apiHandler(async (request) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const data = await parseJsonBody(request, createStocktakeSchema);

  try {
    const stocktake = await createStocktake(data);
    return jsonCreated(stocktake);
  } catch (error) {
    if (error instanceof StocktakeError) return error.toResponse();
    throw error;
  }
});
