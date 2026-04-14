import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { InsufficientStockError } from "@/lib/inventory/stock";
import { pickManufacturingIngredientSchema } from "@/lib/schemas/manufacturing-orders";
import {
  ManufacturingError,
  pickManufacturingIngredient,
} from "@/app/(dashboard)/manufacturing/queries";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const { id, ingredientId } = await (
    ctx as { params: Promise<{ id: string; ingredientId: string }> }
  ).params;
  const body = await request.json().catch(() => ({}));
  pickManufacturingIngredientSchema.parse(body);

  try {
    const result = await pickManufacturingIngredient(id, ingredientId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ManufacturingError) return error.toResponse();
    if (error instanceof InsufficientStockError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
});
