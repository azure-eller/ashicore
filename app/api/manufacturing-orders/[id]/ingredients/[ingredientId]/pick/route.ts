import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey } from "@/lib/api/handler";
import { parseOptionalJsonBody } from "@/lib/api/request-body";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { pickManufacturingIngredientSchema } from "@/lib/schemas/manufacturing-orders";
import { pickManufacturingIngredient } from "@/lib/manufacturing/queries";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "pickManufacturingIngredient");
  const { id, ingredientId } = await (
    ctx as { params: Promise<{ id: string; ingredientId: string }> }
  ).params;
  const data = await parseOptionalJsonBody(
    request,
    pickManufacturingIngredientSchema,
    {},
  );

  const result = await pickManufacturingIngredient(id, ingredientId, {
    idempotencyKey,
    confirmRequirementOverride: data.confirmRequirementOverride,
    confirmNegativeStock: data.confirmNegativeStock,
  });
  return NextResponse.json(result);
});
