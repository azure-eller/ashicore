import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { insertSalesOrderSchema } from "@/lib/schemas/sales-orders";
import {
  createSalesOrder,
  deleteSalesOrders,
  getSalesOrders,
  SalesError,
} from "@/app/(dashboard)/sales/queries";

const deleteSalesOrdersSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

export async function GET() {
  const data = await getSalesOrders();
  return NextResponse.json(data);
}

export const DELETE = apiHandler(async (request) => {
  const body = await request.json();
  const data = deleteSalesOrdersSchema.parse(body);
  const result = await deleteSalesOrders(data.ids);
  return NextResponse.json(result);
});

export const POST = apiHandler(async (request) => {
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
