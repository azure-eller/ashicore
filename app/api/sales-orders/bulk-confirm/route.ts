import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { bulkConfirmSalesOrdersSchema } from "@/lib/schemas/sales-orders";
import { bulkConfirmSalesOrders } from "@/lib/sales/queries/order-write";

export const POST = apiHandler(async (request) => {
  await assertModuleWriteAccess("sales", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "bulkConfirmSalesOrders");
  const data = await parseJsonBody(request, bulkConfirmSalesOrdersSchema);

  const result = await bulkConfirmSalesOrders(data, { idempotencyKey });
  return NextResponse.json(result);
});
