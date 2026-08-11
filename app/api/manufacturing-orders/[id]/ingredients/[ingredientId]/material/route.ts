import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { swapManufacturingIngredientMaterialSchema } from "@/lib/schemas/manufacturing-orders";
import { swapManufacturingIngredientMaterial } from "@/lib/manufacturing/queries/order-write";

export const PATCH = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const { id, ingredientId } = await (
    ctx as { params: Promise<{ id: string; ingredientId: string }> }
  ).params;
  const data = await parseJsonBody(request, swapManufacturingIngredientMaterialSchema);

  const result = await swapManufacturingIngredientMaterial(id, ingredientId, data);
  return NextResponse.json(result);
});
