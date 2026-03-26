import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import {
  deleteManufacturingOrdersSchema,
  insertManufacturingOrderSchema,
} from "@/lib/schemas/manufacturing-orders";
import {
  createManufacturingOrder,
  deleteManufacturingOrders,
  getManufacturingOrders,
  ManufacturingError,
} from "@/app/(dashboard)/manufacturing/queries";

export async function GET() {
  const data = await getManufacturingOrders();
  return NextResponse.json(data);
}

export const DELETE = apiHandler(async (request) => {
  const body = await request.json();
  const data = deleteManufacturingOrdersSchema.parse(body);
  const result = await deleteManufacturingOrders(data.ids);

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result);
});

export const POST = apiHandler(async (request) => {
  const body = await request.json();
  const data = insertManufacturingOrderSchema.parse(body);

  try {
    const order = await createManufacturingOrder(data);
    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    if (error instanceof ManufacturingError) return error.toResponse();
    throw error;
  }
});
