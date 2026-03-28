import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { insertSalesOrderSchema } from "@/lib/schemas/sales-orders";
import { bulkDeleteSchema } from "@/lib/schemas/shared";
import {
  createSalesOrder,
  deleteSalesOrders,
  getSalesOrders,
  SalesError,
} from "@/app/(dashboard)/sales/queries";


export const GET = apiHandler(async (request) => {
  await assertModuleReadAccess("sales", request.headers);
  const data = await getSalesOrders();
  return NextResponse.json(data);
});

export const DELETE = apiHandler(async (request) => {
  await assertModuleWriteAccess("sales", request.headers);
  const body = await request.json();
  const data = bulkDeleteSchema.parse(body);
  const result = await deleteSalesOrders(data.ids);
  return NextResponse.json(result);
});

export const POST = apiHandler(async (request) => {
  await assertModuleWriteAccess("sales", request.headers);
  const body = await request.json();
  const data = insertSalesOrderSchema.parse(body);

  try {
    const order = await createSalesOrder(data);
    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});
