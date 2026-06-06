import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonNotFound } from "@/lib/api/responses";
import {
  getStocktakeCompletionPreview,
  StocktakeError,
} from "@/lib/dal/stocktakes";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { previewInventoryReconciliation } from "@/lib/dal/inventory-reconciliations";
import { inventoryReconciliationSchema } from "@/lib/schemas/inventory-reconciliations";

export const POST = apiHandler(async (request: Request) => {
  await assertModuleReadAccess("inventory", request.headers);
  const input = await parseJsonBody(request, inventoryReconciliationSchema);

  if (input.source.kind === "stocktake") {
    try {
      const preview = await getStocktakeCompletionPreview(input.source.stocktakeId);
      if (!preview) return jsonNotFound("Stocktake not found");
      return NextResponse.json(preview);
    } catch (error) {
      if (error instanceof StocktakeError) return error.toResponse();
      throw error;
    }
  }

  const result = await previewInventoryReconciliation(input);

  if (result instanceof NextResponse) {
    return result;
  }

  return NextResponse.json(result);
});
