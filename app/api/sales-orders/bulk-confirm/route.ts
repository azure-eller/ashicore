import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { bulkConfirmSalesOrdersSchema } from "@/lib/schemas/sales-orders";
import {
  bulkConfirmSalesOrders,
  SalesError,
} from "@/app/(dashboard)/sales/queries";

export const POST = apiHandler(async (request) => {
  await assertModuleWriteAccess("sales", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "bulkConfirmSalesOrders");
  const data = await parseJsonBody(request, bulkConfirmSalesOrdersSchema);

  try {
    const result = await bulkConfirmSalesOrders(data, { idempotencyKey });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});
