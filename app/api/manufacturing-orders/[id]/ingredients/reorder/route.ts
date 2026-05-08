import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { reorderManufacturingIngredientsSchema } from "@/lib/schemas/manufacturing-orders";
import {
  ManufacturingError,
  reorderManufacturingOrderIngredients,
} from "@/app/(dashboard)/manufacturing/queries";

export const PATCH = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params;
  const body = await request.json();
  const data = reorderManufacturingIngredientsSchema.parse(body);

  try {
    const result = await reorderManufacturingOrderIngredients(id, data);

    if (!result) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ManufacturingError) return error.toResponse();
    throw error;
  }
});
