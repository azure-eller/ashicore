import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonNotFound } from "@/lib/api/responses";
import {
  completeStocktake,
  StocktakeError,
} from "@/lib/dal/stocktakes";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { applyInventoryReconciliation } from "@/lib/dal/inventory-reconciliations";
import { inventoryReconciliationSchema } from "@/lib/schemas/inventory-reconciliations";

export const POST = apiHandler(async (request: Request) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const input = await parseJsonBody(request, inventoryReconciliationSchema);
  const idempotencyKey = requireIdempotencyKey(
    request,
    input.source.kind === "stocktake" ? "completeStocktake" : "inventoryReconciliation"
  );

  if (input.source.kind === "stocktake") {
    try {
      const stocktake = await completeStocktake(
        input.source.stocktakeId,
        input.source.confirmStale,
        {
          idempotencyKey,
          reason: input.source.reason,
        }
      );
      if (!stocktake) return jsonNotFound("Stocktake not found");
      return NextResponse.json(stocktake);
    } catch (error) {
      if (error instanceof StocktakeError) return error.toResponse();
      throw error;
    }
  }

  const result = await applyInventoryReconciliation(input, { idempotencyKey });

  if (result instanceof NextResponse) {
    return result;
  }

  return NextResponse.json(result);
});
