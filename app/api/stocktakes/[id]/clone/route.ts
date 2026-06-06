import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonNotFound, jsonCreated } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { cloneStocktakeSchema } from "@/lib/schemas/stocktakes";
import {
  cloneStocktake,
  StocktakeError,
} from "@/lib/dal/stocktakes";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  await assertModuleWriteAccess("inventory", request.headers);
  const data = await parseJsonBody(request, cloneStocktakeSchema);

  try {
    const stocktake = await cloneStocktake(id, data);

    if (!stocktake) {
      return jsonNotFound("Stocktake not found");
    }

    return jsonCreated(stocktake);
  } catch (error) {
    if (error instanceof StocktakeError) return error.toResponse();
    throw error;
  }
});
