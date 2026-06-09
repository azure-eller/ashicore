import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { parseOptionalJsonBody } from "@/lib/api/request-body";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { pickManufacturingIngredientSchema } from "@/lib/schemas/manufacturing-orders";
import { pickRemainingManufacturingIngredients } from "@/app/(dashboard)/manufacturing/queries";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const idempotencyKey = requireIdempotencyKey(
    request,
    "pickRemainingManufacturingIngredients"
  );
  const { id } = await (ctx as RouteContext).params;
  const data = await parseOptionalJsonBody(
    request,
    pickManufacturingIngredientSchema,
    {},
  );

  const result = await pickRemainingManufacturingIngredients(id, {
    idempotencyKey,
    confirmRequirementOverride: data.confirmRequirementOverride,
    confirmNegativeStock: data.confirmNegativeStock,
  });
  return NextResponse.json(result);
});
