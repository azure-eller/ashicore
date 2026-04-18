import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { pickManufacturingIngredientSchema } from "@/lib/schemas/manufacturing-orders";
import {
  ManufacturingError,
  pickManufacturingIngredient,
} from "@/app/(dashboard)/manufacturing/queries";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "pickManufacturingIngredient");
  const { id, ingredientId } = await (
    ctx as { params: Promise<{ id: string; ingredientId: string }> }
  ).params;
  const body = await request.json().catch(() => ({}));
  pickManufacturingIngredientSchema.parse(body);

  try {
    const result = await pickManufacturingIngredient(id, ingredientId, {
      idempotencyKey,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ManufacturingError) return error.toResponse();
    throw error;
  }
});
