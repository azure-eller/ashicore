import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonNotFound } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { reorderManufacturingIngredientsSchema } from "@/lib/schemas/manufacturing-orders";
import { reorderManufacturingOrderIngredients } from "@/lib/manufacturing/queries/priority";

export const PATCH = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params;
  const data = await parseJsonBody(request, reorderManufacturingIngredientsSchema);

  const result = await reorderManufacturingOrderIngredients(id, data);

  if (!result) {
    return jsonNotFound("Order not found");
  }

  return NextResponse.json(result);
});
