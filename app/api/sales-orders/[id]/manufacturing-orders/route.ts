import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { createManufacturingOrdersFromSalesOrderSchema } from "@/lib/schemas/manufacturing-orders";
import {
  createManufacturingOrdersFromSalesOrder,
  getManufacturingSalesOrderPreview,
  ManufacturingError,
} from "@/app/(dashboard)/manufacturing/queries";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const preview = await getManufacturingSalesOrderPreview(id);

  if (!preview) {
    return NextResponse.json({ error: "Sales order not found" }, { status: 404 });
  }

  return NextResponse.json(preview);
}

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  const body = await request.json();
  const data = createManufacturingOrdersFromSalesOrderSchema.parse(body);

  try {
    const result = await createManufacturingOrdersFromSalesOrder(id, data);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ManufacturingError) return error.toResponse();
    throw error;
  }
});
