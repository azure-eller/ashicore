import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { patchManufacturingOrderIngredientSchema } from "@/lib/schemas/manufacturing-orders";
import {
  ManufacturingError,
  patchManufacturingOrderIngredient,
} from "@/app/(dashboard)/manufacturing/queries";

type IngredientRouteContext = {
  params: Promise<{ id: string; ingredientId: string }>;
};

export const PATCH = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const { id, ingredientId } = await (ctx as IngredientRouteContext).params;
  const body = await request.json();
  const data = patchManufacturingOrderIngredientSchema.parse(body);

  try {
    const result = await patchManufacturingOrderIngredient(id, ingredientId, data);
    if (!result) {
      return NextResponse.json({ error: "Ingredient not found" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ManufacturingError) return error.toResponse();
    throw error;
  }
});
