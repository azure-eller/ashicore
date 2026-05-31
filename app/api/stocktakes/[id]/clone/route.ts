import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { jsonNotFound, jsonCreated } from "@/lib/api/responses";
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
      return jsonNotFound("Stocktake not found");
    }

    return jsonCreated(stocktake);
  } catch (error) {
    if (error instanceof StocktakeError) return error.toResponse();
    throw error;
  }
});
