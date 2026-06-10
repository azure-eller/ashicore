import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonNotFound } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { patchManufacturingOrderIngredientSchema } from "@/lib/schemas/manufacturing-orders";
import { patchManufacturingOrderIngredient } from "@/lib/manufacturing/queries/order-write";

type IngredientRouteContext = {
  params: Promise<{ id: string; ingredientId: string }>;
};

export const PATCH = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const { id, ingredientId } = await (ctx as IngredientRouteContext).params;
  const data = await parseJsonBody(request, patchManufacturingOrderIngredientSchema);

  const result = await patchManufacturingOrderIngredient(id, ingredientId, data);
  if (!result) {
    return jsonNotFound("Ingredient not found");
  }
  return NextResponse.json(result);
});
