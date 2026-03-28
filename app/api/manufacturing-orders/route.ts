import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { bulkDeleteSchema } from "@/lib/schemas/shared";
import { insertManufacturingOrderSchema } from "@/lib/schemas/manufacturing-orders";
import {
  createManufacturingOrder,
  deleteManufacturingOrders,
  getManufacturingOrders,
  ManufacturingError,
} from "@/app/(dashboard)/manufacturing/queries";

export const GET = apiHandler(async (request) => {
  await assertModuleReadAccess("manufacturing", request.headers);
  const data = await getManufacturingOrders();
  return NextResponse.json(data);
});

export const DELETE = apiHandler(async (request) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const body = await request.json();
  const data = bulkDeleteSchema.parse(body);
  const result = await deleteManufacturingOrders(data.ids);

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result);
});

export const POST = apiHandler(async (request) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
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
