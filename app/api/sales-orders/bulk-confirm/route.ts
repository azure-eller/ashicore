import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { bulkConfirmSalesOrdersSchema } from "@/lib/schemas/sales-orders";
import {
  bulkConfirmSalesOrders,
  SalesError,
} from "@/app/(dashboard)/sales/queries";

export const POST = apiHandler(async (request) => {
  const body = await request.json();
  const data = bulkConfirmSalesOrdersSchema.parse(body);

  try {
    const result = await bulkConfirmSalesOrders(data);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});
